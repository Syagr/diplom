// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AutoPassport
 * @dev NFT contract для создания цифровых паспортов автомобилей
 * Каждый NFT представляет уникальный автомобиль и содержит историю его обслуживания
 */
contract AutoPassport is ERC721, ERC721URIStorage, Ownable, Pausable, ReentrancyGuard {
    uint256 private _nextTokenId;
    
    // Структура данных автомобиля
    struct Vehicle {
        string vin;           // VIN номер
        string plate;         // Номерной знак
        string make;          // Марка
        string model;         // Модель
        uint16 year;          // Год выпуска
        uint256 createdAt;    // Время создания NFT
        address originalOwner; // Первый владелец
    }
    
    // Структура записи сервиса
    struct ServiceRecord {
        uint256 orderId;      // ID заказа из основной системы
        string serviceType;   // Тип сервиса (repair, maintenance, inspection)
        uint256 mileage;      // Пробег на момент сервиса
        uint256 cost;         // Стоимость в wei
        string description;   // Описание работ
        address serviceCenter; // Адрес сервисного центра
        uint256 timestamp;    // Время выполнения
        string ipfsHash;      // IPFS хеш документов
    }
    
    // Маппинги
    mapping(uint256 => Vehicle) public vehicles;
    mapping(uint256 => ServiceRecord[]) public serviceHistory;
    mapping(string => uint256) public vinToTokenId; // VIN -> Token ID
    mapping(string => uint256) public plateToTokenId; // Plate -> Token ID
    mapping(address => bool) public authorizedServiceCenters;
    
    // События
    event VehicleCreated(uint256 indexed tokenId, string vin, string plate, address owner);
    event ServiceRecordAdded(uint256 indexed tokenId, uint256 orderId, string serviceType, uint256 cost);
    event ServiceCenterAuthorized(address indexed serviceCenter, bool status);
    event VehicleTransferred(uint256 indexed tokenId, address from, address to);
    
    // Модификаторы
    modifier onlyAuthorizedService() {
        require(authorizedServiceCenters[msg.sender] || msg.sender == owner(), "Not authorized service center");
        _;
    }
    
    modifier validTokenId(uint256 tokenId) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        _;
    }

    constructor(address initialOwner) 
        ERC721("AutoAssist Vehicle Passport", "AAVP") 
        Ownable(initialOwner) 
    {
        _nextTokenId = 1;
    }

    /**
     * @dev Создание NFT паспорта для автомобиля
     */
    function mintVehiclePassport(
        address to,
        string memory vin,
        string memory plate,
        string memory make,
        string memory model,
        uint16 year,
        string memory tokenURI
    ) public onlyOwner whenNotPaused returns (uint256) {
        require(bytes(vin).length > 0, "VIN cannot be empty");
        require(bytes(plate).length > 0, "Plate cannot be empty");
        require(vinToTokenId[vin] == 0, "VIN already exists");
        require(plateToTokenId[plate] == 0, "Plate already exists");
        
        uint256 tokenId = _nextTokenId++;
        
        // Создаем NFT
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI);
        
        // Сохраняем данные автомобиля
        vehicles[tokenId] = Vehicle({
            vin: vin,
            plate: plate,
            make: make,
            model: model,
            year: year,
            createdAt: block.timestamp,
            originalOwner: to
        });
        
        // Обновляем маппинги
        vinToTokenId[vin] = tokenId;
        plateToTokenId[plate] = tokenId;
        
        emit VehicleCreated(tokenId, vin, plate, to);
        return tokenId;
    }

    /**
     * @dev Добавление записи о сервисе
     */
    function addServiceRecord(
        uint256 tokenId,
        uint256 orderId,
        string memory serviceType,
        uint256 mileage,
        uint256 cost,
        string memory description,
        string memory ipfsHash
    ) public onlyAuthorizedService validTokenId(tokenId) whenNotPaused {
        require(bytes(serviceType).length > 0, "Service type cannot be empty");
        require(mileage > 0, "Mileage must be greater than 0");
        
        ServiceRecord memory newRecord = ServiceRecord({
            orderId: orderId,
            serviceType: serviceType,
            mileage: mileage,
            cost: cost,
            description: description,
            serviceCenter: msg.sender,
            timestamp: block.timestamp,
            ipfsHash: ipfsHash
        });
        
        serviceHistory[tokenId].push(newRecord);
        
        emit ServiceRecordAdded(tokenId, orderId, serviceType, cost);
    }

    /**
     * @dev Авторизация сервисного центра
     */
    function authorizeServiceCenter(address serviceCenter, bool status) 
        public onlyOwner 
    {
        authorizedServiceCenters[serviceCenter] = status;
        emit ServiceCenterAuthorized(serviceCenter, status);
    }

    /**
     * @dev Получение истории сервиса автомобиля
     */
    function getServiceHistory(uint256 tokenId) 
        public view validTokenId(tokenId) 
        returns (ServiceRecord[] memory) 
    {
        return serviceHistory[tokenId];
    }

    /**
     * @dev Получение количества записей сервиса
     */
    function getServiceRecordCount(uint256 tokenId) 
        public view validTokenId(tokenId) 
        returns (uint256) 
    {
        return serviceHistory[tokenId].length;
    }

    /**
     * @dev Получение данных автомобиля
     */
    function getVehicleData(uint256 tokenId) 
        public view validTokenId(tokenId) 
        returns (Vehicle memory) 
    {
        return vehicles[tokenId];
    }

    /**
     * @dev Поиск токена по VIN
     */
    function getTokenByVIN(string memory vin) 
        public view 
        returns (uint256) 
    {
        return vinToTokenId[vin];
    }

    /**
     * @dev Поиск токена по номерному знаку
     */
    function getTokenByPlate(string memory plate) 
        public view 
        returns (uint256) 
    {
        return plateToTokenId[plate];
    }

    /**
     * @dev Общее количество выпущенных токенов
     */
    function totalSupply() public view returns (uint256) {
        return _nextTokenId - 1;
    }

    /**
     * @dev Пауза контракта
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @dev Снятие паузы
     */
    function unpause() public onlyOwner {
        _unpause();
    }

    /**
     * @dev Обработка передачи токена
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        whenNotPaused
        returns (address)
    {
        address from = _ownerOf(tokenId);
        
        if (from != address(0) && to != address(0)) {
            emit VehicleTransferred(tokenId, from, to);
        }
        
        return super._update(to, tokenId, auth);
    }

    /**
     * @dev Переопределение функций для совместимости с ERC721URIStorage
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}