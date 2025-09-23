// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PaymentEscrow
 * @dev Escrow контракт для безопасных платежей за автосервис
 * Поддерживает многосторонние платежи (клиент -> сервис, страховка)
 */
contract PaymentEscrow is ReentrancyGuard, Ownable, Pausable {
    
    enum PaymentStatus {
        PENDING,    // Ожидает подтверждения
        ESCROWED,   // Средства заблокированы
        COMPLETED,  // Платеж завершен
        REFUNDED,   // Возврат средств
        DISPUTED    // Спор
    }
    
    struct Payment {
        uint256 orderId;        // ID заказа из основной системы
        address payer;          // Плательщик (клиент)
        address payee;          // Получатель (сервис)
        uint256 amount;         // Сумма платежа
        uint256 serviceAmount;  // Сумма для сервиса
        uint256 insuranceAmount; // Сумма для страховки (если есть)
        address insuranceProvider; // Адрес страховой компании
        PaymentStatus status;   // Статус платежа
        uint256 createdAt;      // Время создания
        uint256 expiresAt;      // Время истечения
        bool serviceCompleted;  // Сервис завершен
        bool clientApproved;    // Клиент подтвердил
        string ipfsHash;        // IPFS хеш документов
    }
    
    struct Dispute {
        uint256 paymentId;
        address initiator;
        string reason;
        uint256 createdAt;
        bool resolved;
        address winner;
    }
    
    // State variables
    mapping(uint256 => Payment) public payments;
    mapping(uint256 => Dispute) public disputes;
    mapping(address => bool) public authorizedServices;
    mapping(address => bool) public authorizedInsurers;
    
    uint256 private _nextPaymentId;
    uint256 private _nextDisputeId;
    uint256 public serviceFeePercent = 250; // 2.5% комиссия платформы
    uint256 public constant MAX_FEE_PERCENT = 1000; // Максимум 10%
    uint256 public constant ESCROW_PERIOD = 7 days; // Период эскроу
    
    address public feeCollector;
    
    // Events
    event PaymentCreated(uint256 indexed paymentId, uint256 indexed orderId, address payer, uint256 amount);
    event PaymentEscrowed(uint256 indexed paymentId, uint256 amount);
    event PaymentCompleted(uint256 indexed paymentId, uint256 serviceAmount, uint256 insuranceAmount);
    event PaymentRefunded(uint256 indexed paymentId, uint256 amount);
    event DisputeCreated(uint256 indexed disputeId, uint256 indexed paymentId, address initiator);
    event DisputeResolved(uint256 indexed disputeId, address winner);
    event ServiceAuthorized(address indexed service, bool status);
    event InsurerAuthorized(address indexed insurer, bool status);
    
    modifier onlyAuthorizedService() {
        require(authorizedServices[msg.sender] || msg.sender == owner(), "Not authorized service");
        _;
    }
    
    modifier onlyParties(uint256 paymentId) {
        Payment memory payment = payments[paymentId];
        require(
            msg.sender == payment.payer || 
            msg.sender == payment.payee || 
            msg.sender == owner(),
            "Not authorized"
        );
        _;
    }
    
    modifier validPayment(uint256 paymentId) {
        require(payments[paymentId].payer != address(0), "Payment does not exist");
        _;
    }

    constructor(address initialOwner, address _feeCollector) Ownable(initialOwner) {
        feeCollector = _feeCollector;
        _nextPaymentId = 1;
        _nextDisputeId = 1;
    }

    /**
     * @dev Создание нового платежа
     */
    function createPayment(
        uint256 orderId,
        address payee,
        uint256 serviceAmount,
        uint256 insuranceAmount,
        address insuranceProvider,
        string memory ipfsHash
    ) external payable whenNotPaused nonReentrant returns (uint256) {
        require(payee != address(0), "Invalid payee");
        require(msg.value > 0, "Payment amount must be greater than 0");
        require(msg.value == serviceAmount + insuranceAmount, "Amount mismatch");
        require(authorizedServices[payee], "Service not authorized");
        
        if (insuranceAmount > 0) {
            require(insuranceProvider != address(0), "Invalid insurance provider");
            require(authorizedInsurers[insuranceProvider], "Insurer not authorized");
        }
        
        uint256 paymentId = _nextPaymentId++;
        
        payments[paymentId] = Payment({
            orderId: orderId,
            payer: msg.sender,
            payee: payee,
            amount: msg.value,
            serviceAmount: serviceAmount,
            insuranceAmount: insuranceAmount,
            insuranceProvider: insuranceProvider,
            status: PaymentStatus.ESCROWED,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + ESCROW_PERIOD,
            serviceCompleted: false,
            clientApproved: false,
            ipfsHash: ipfsHash
        });
        
        emit PaymentCreated(paymentId, orderId, msg.sender, msg.value);
        emit PaymentEscrowed(paymentId, msg.value);
        
        return paymentId;
    }

    /**
     * @dev Подтверждение завершения сервиса (со стороны сервиса)
     */
    function confirmServiceCompleted(uint256 paymentId) 
        external 
        validPayment(paymentId) 
        whenNotPaused 
    {
        Payment storage payment = payments[paymentId];
        require(msg.sender == payment.payee, "Only service provider can confirm");
        require(payment.status == PaymentStatus.ESCROWED, "Invalid payment status");
        require(block.timestamp <= payment.expiresAt, "Payment expired");
        
        payment.serviceCompleted = true;
        
        // Автоматический релиз если клиент уже подтвердил
        if (payment.clientApproved) {
            _releasePayment(paymentId);
        }
    }

    /**
     * @dev Подтверждение получения услуги (со стороны клиента)
     */
    function approveService(uint256 paymentId) 
        external 
        validPayment(paymentId) 
        whenNotPaused 
    {
        Payment storage payment = payments[paymentId];
        require(msg.sender == payment.payer, "Only payer can approve");
        require(payment.status == PaymentStatus.ESCROWED, "Invalid payment status");
        require(block.timestamp <= payment.expiresAt, "Payment expired");
        
        payment.clientApproved = true;
        
        // Автоматический релиз если сервис уже завершен
        if (payment.serviceCompleted) {
            _releasePayment(paymentId);
        }
    }

    /**
     * @dev Принудительный релиз платежа (только владелец)
     */
    function forceReleasePayment(uint256 paymentId) 
        external 
        onlyOwner 
        validPayment(paymentId) 
    {
        _releasePayment(paymentId);
    }

    /**
     * @dev Возврат средств
     */
    function refundPayment(uint256 paymentId) 
        external 
        validPayment(paymentId) 
        nonReentrant 
    {
        Payment storage payment = payments[paymentId];
        require(
            msg.sender == payment.payer || 
            msg.sender == owner() ||
            block.timestamp > payment.expiresAt,
            "Not authorized to refund"
        );
        require(payment.status == PaymentStatus.ESCROWED, "Cannot refund");
        
        payment.status = PaymentStatus.REFUNDED;
        
        // Возврат средств плательщику
        (bool success, ) = payment.payer.call{value: payment.amount}("");
        require(success, "Refund failed");
        
        emit PaymentRefunded(paymentId, payment.amount);
    }

    /**
     * @dev Создание спора
     */
    function createDispute(uint256 paymentId, string memory reason) 
        external 
        validPayment(paymentId) 
        onlyParties(paymentId) 
        returns (uint256) 
    {
        Payment storage payment = payments[paymentId];
        require(payment.status == PaymentStatus.ESCROWED, "Cannot dispute this payment");
        require(bytes(reason).length > 0, "Reason cannot be empty");
        
        payment.status = PaymentStatus.DISPUTED;
        
        uint256 disputeId = _nextDisputeId++;
        disputes[disputeId] = Dispute({
            paymentId: paymentId,
            initiator: msg.sender,
            reason: reason,
            createdAt: block.timestamp,
            resolved: false,
            winner: address(0)
        });
        
        emit DisputeCreated(disputeId, paymentId, msg.sender);
        return disputeId;
    }

    /**
     * @dev Разрешение спора (только владелец)
     */
    function resolveDispute(uint256 disputeId, address winner) 
        external 
        onlyOwner 
    {
        Dispute storage dispute = disputes[disputeId];
        require(!dispute.resolved, "Dispute already resolved");
        require(winner != address(0), "Invalid winner");
        
        Payment storage payment = payments[dispute.paymentId];
        require(payment.status == PaymentStatus.DISPUTED, "Payment not in dispute");
        
        dispute.resolved = true;
        dispute.winner = winner;
        
        if (winner == payment.payer) {
            // Возврат клиенту
            payment.status = PaymentStatus.REFUNDED;
            (bool success, ) = payment.payer.call{value: payment.amount}("");
            require(success, "Refund failed");
        } else {
            // Выплата сервису
            _releasePayment(dispute.paymentId);
        }
        
        emit DisputeResolved(disputeId, winner);
    }

    /**
     * @dev Внутренняя функция для релиза платежа
     */
    function _releasePayment(uint256 paymentId) internal {
        Payment storage payment = payments[paymentId];
        require(payment.status == PaymentStatus.ESCROWED || payment.status == PaymentStatus.DISPUTED, "Cannot release");
        
        payment.status = PaymentStatus.COMPLETED;
        
        uint256 totalAmount = payment.amount;
        uint256 platformFee = (totalAmount * serviceFeePercent) / 10000;
        uint256 remainingAmount = totalAmount - platformFee;
        
        // Выплата комиссии платформы
        if (platformFee > 0) {
            (bool feeSuccess, ) = feeCollector.call{value: platformFee}("");
            require(feeSuccess, "Fee transfer failed");
        }
        
        // Выплата сервису
        if (payment.serviceAmount > 0) {
            uint256 serviceNetAmount = payment.serviceAmount - (payment.serviceAmount * serviceFeePercent) / 10000;
            (bool serviceSuccess, ) = payment.payee.call{value: serviceNetAmount}("");
            require(serviceSuccess, "Service payment failed");
        }
        
        // Выплата страховой
        if (payment.insuranceAmount > 0 && payment.insuranceProvider != address(0)) {
            uint256 insuranceNetAmount = payment.insuranceAmount - (payment.insuranceAmount * serviceFeePercent) / 10000;
            (bool insuranceSuccess, ) = payment.insuranceProvider.call{value: insuranceNetAmount}("");
            require(insuranceSuccess, "Insurance payment failed");
        }
        
        emit PaymentCompleted(paymentId, payment.serviceAmount, payment.insuranceAmount);
    }

    /**
     * @dev Авторизация сервисного центра
     */
    function authorizeService(address service, bool status) external onlyOwner {
        authorizedServices[service] = status;
        emit ServiceAuthorized(service, status);
    }

    /**
     * @dev Авторизация страховой компании
     */
    function authorizeInsurer(address insurer, bool status) external onlyOwner {
        authorizedInsurers[insurer] = status;
        emit InsurerAuthorized(insurer, status);
    }

    /**
     * @dev Установка комиссии платформы
     */
    function setServiceFee(uint256 newFeePercent) external onlyOwner {
        require(newFeePercent <= MAX_FEE_PERCENT, "Fee too high");
        serviceFeePercent = newFeePercent;
    }

    /**
     * @dev Изменение адреса сборщика комиссий
     */
    function setFeeCollector(address newFeeCollector) external onlyOwner {
        require(newFeeCollector != address(0), "Invalid address");
        feeCollector = newFeeCollector;
    }

    /**
     * @dev Пауза контракта
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Снятие паузы
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Получение данных платежа
     */
    function getPayment(uint256 paymentId) 
        external 
        view 
        validPayment(paymentId) 
        returns (Payment memory) 
    {
        return payments[paymentId];
    }

    /**
     * @dev Получение данных спора
     */
    function getDispute(uint256 disputeId) 
        external 
        view 
        returns (Dispute memory) 
    {
        return disputes[disputeId];
    }

    /**
     * @dev Экстренный вывод средств (только владелец)
     */
    function emergencyWithdraw() external onlyOwner {
        (bool success, ) = owner().call{value: address(this).balance}("");
        require(success, "Withdrawal failed");
    }
}