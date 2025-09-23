import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { ethers } from 'ethers';
import crypto from 'crypto';
import { logger } from '../libs/logger';
import { formatCurrency } from '@autoassist/shared';

const prisma = new PrismaClient();

// Payment provider configurations
const PAYMENT_CONFIG = {
  LIQPAY: {
    PUBLIC_KEY: process.env.LIQPAY_PUBLIC_KEY || '',
    PRIVATE_KEY: process.env.LIQPAY_PRIVATE_KEY || '',
    SERVER_URL: process.env.LIQPAY_SERVER_URL || 'https://www.liqpay.ua/api/',
    SANDBOX: process.env.NODE_ENV !== 'production'
  },
  WEB3: {
    RPC_URL: process.env.WEB3_RPC_URL || '',
    PRIVATE_KEY: process.env.WEB3_PRIVATE_KEY || '',
    ESCROW_ADDRESS: process.env.ESCROW_ADDRESS || ''
  }
};

export class PaymentsService {
  private web3Provider?: ethers.JsonRpcProvider;
  private wallet?: ethers.Wallet;

  constructor() {
    if (PAYMENT_CONFIG.WEB3.RPC_URL && PAYMENT_CONFIG.WEB3.PRIVATE_KEY) {
      this.web3Provider = new ethers.JsonRpcProvider(PAYMENT_CONFIG.WEB3.RPC_URL);
      this.wallet = new ethers.Wallet(PAYMENT_CONFIG.WEB3.PRIVATE_KEY, this.web3Provider);
    }
  }

  /**
   * Create payment invoice for order
   */
  async createInvoice(req: Request, res: Response): Promise<void> {
    const { orderId, amount, currency = 'UAH', method = 'CREDIT_CARD', returnUrl } = req.body;

    try {
      if (!orderId || !amount) {
        res.status(400).json({
          error: 'MISSING_PARAMS',
          message: 'orderId and amount are required'
        });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          client: true,
          estimate: true
        }
      });

      if (!order) {
        res.status(404).json({
          error: 'ORDER_NOT_FOUND',
          message: 'Order not found'
        });
        return;
      }

      // Validate amount against estimate
      if (order.estimate && Math.abs(amount - order.estimate.totalAmount) > 1) {
        res.status(400).json({
          error: 'AMOUNT_MISMATCH',
          message: 'Payment amount does not match order estimate'
        });
        return;
      }

      // Create payment record
      const payment = await prisma.payment.create({
        data: {
          orderId,
          clientId: order.clientId,
          amount,
          currency,
          method,
          status: 'PENDING',
          metadata: {
            returnUrl,
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip
          }
        }
      });

      let checkoutData;

      // Generate checkout based on payment method
      switch (method) {
        case 'CREDIT_CARD':
          checkoutData = await this.createLiqPayCheckout(payment, order, returnUrl);
          break;
        case 'CRYPTOCURRENCY':
          checkoutData = await this.createCryptoPayment(payment, order);
          break;
        case 'ESCROW':
          checkoutData = await this.createEscrowPayment(payment, order);
          break;
        default:
          throw new Error(`Payment method ${method} not supported`);
      }

      // Update payment with provider data
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          providerTransactionId: checkoutData.transactionId,
          metadata: {
            ...payment.metadata,
            ...checkoutData.metadata
          }
        }
      });

      logger.info('Payment invoice created', {
        paymentId: payment.id,
        orderId,
        amount,
        method,
        transactionId: checkoutData.transactionId
      });

      res.status(201).json({
        success: true,
        data: {
          paymentId: payment.id,
          checkoutUrl: checkoutData.checkoutUrl,
          transactionId: checkoutData.transactionId,
          expiresAt: checkoutData.expiresAt
        }
      });

    } catch (error) {
      logger.error('Failed to create payment invoice', {
        orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to create payment invoice'
      });
    }
  }

  /**
   * Handle payment webhook from provider
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    const provider = req.params.provider || req.headers['x-provider'];

    try {
      let paymentUpdate;

      switch (provider) {
        case 'liqpay':
          paymentUpdate = await this.handleLiqPayWebhook(req);
          break;
        case 'crypto':
          paymentUpdate = await this.handleCryptoWebhook(req);
          break;
        default:
          res.status(400).json({ error: 'UNKNOWN_PROVIDER' });
          return;
      }

      if (!paymentUpdate) {
        res.status(400).json({ error: 'INVALID_WEBHOOK' });
        return;
      }

      // Update payment status
      const payment = await this.updatePaymentStatus(paymentUpdate);

      // Trigger order status update if payment successful
      if (payment.status === 'COMPLETED') {
        await this.handleSuccessfulPayment(payment);
      }

      logger.info('Webhook processed', {
        provider,
        paymentId: payment.id,
        status: payment.status,
        transactionId: payment.providerTransactionId
      });

      res.json({ success: true });

    } catch (error) {
      logger.error('Webhook processing failed', {
        provider,
        error: error instanceof Error ? error.message : String(error),
        body: req.body
      });
      res.status(500).json({ error: 'WEBHOOK_ERROR' });
    }
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(req: Request, res: Response): Promise<void> {
    const { paymentId } = req.params;

    try {
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
          order: {
            select: {
              id: true,
              status: true
            }
          }
        }
      });

      if (!payment) {
        res.status(404).json({
          error: 'PAYMENT_NOT_FOUND',
          message: 'Payment not found'
        });
        return;
      }

      res.json({
        success: true,
        data: {
          id: payment.id,
          status: payment.status,
          amount: payment.amount,
          amountFormatted: formatCurrency(payment.amount, payment.currency),
          currency: payment.currency,
          method: payment.method,
          transactionId: payment.providerTransactionId,
          blockchainTxHash: payment.blockchainTxHash,
          createdAt: payment.createdAt,
          completedAt: payment.completedAt,
          order: payment.order
        }
      });

    } catch (error) {
      logger.error('Failed to get payment status', {
        paymentId,
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to get payment status'
      });
    }
  }

  /**
   * Create LiqPay checkout
   */
  private async createLiqPayCheckout(payment: any, order: any, returnUrl?: string): Promise<any> {
    const orderDescription = `AutoAssist Order #${order.id.slice(-8)}`;
    
    const liqpayData = {
      version: '3',
      public_key: PAYMENT_CONFIG.LIQPAY.PUBLIC_KEY,
      action: 'pay',
      amount: payment.amount,
      currency: payment.currency,
      description: orderDescription,
      order_id: payment.id,
      result_url: returnUrl || `${process.env.WEB_URL}/orders/${order.id}`,
      server_url: `${process.env.API_URL}/api/payments/webhook/liqpay`,
      language: 'uk',
      sandbox: PAYMENT_CONFIG.LIQPAY.SANDBOX ? '1' : '0'
    };

    const data = Buffer.from(JSON.stringify(liqpayData)).toString('base64');
    const signature = this.generateLiqPaySignature(data);

    const checkoutUrl = `${PAYMENT_CONFIG.LIQPAY.SERVER_URL}3/checkout?data=${data}&signature=${signature}`;

    return {
      checkoutUrl,
      transactionId: payment.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      metadata: {
        liqpayData: data,
        liqpaySignature: signature
      }
    };
  }

  /**
   * Create cryptocurrency payment
   */
  private async createCryptoPayment(payment: any, order: any): Promise<any> {
    if (!this.wallet) {
      throw new Error('Web3 provider not configured');
    }

    // For demo, use a fixed wallet address for crypto payments
    const walletAddress = this.wallet.address;
    
    // Convert UAH to approximate ETH/MATIC amount (mock conversion)
    const cryptoAmount = (payment.amount / 30000).toFixed(6); // ~30k UAH per ETH

    return {
      checkoutUrl: `${process.env.WEB_URL}/payments/crypto/${payment.id}`,
      transactionId: payment.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      metadata: {
        walletAddress,
        cryptoAmount,
        network: 'Polygon',
        currency: 'MATIC'
      }
    };
  }

  /**
   * Create escrow payment (smart contract)
   */
  private async createEscrowPayment(payment: any, order: any): Promise<any> {
    if (!this.wallet || !PAYMENT_CONFIG.WEB3.ESCROW_ADDRESS) {
      throw new Error('Web3 escrow not configured');
    }

    // This would interact with the PaymentEscrow smart contract
    const escrowData = {
      orderId: order.id,
      amount: ethers.parseEther((payment.amount / 30000).toString()), // Convert to ETH
      buyer: '0x...', // Client's wallet address
      seller: this.wallet.address,
      arbiter: this.wallet.address // Platform as arbiter
    };

    return {
      checkoutUrl: `${process.env.WEB_URL}/payments/escrow/${payment.id}`,
      transactionId: payment.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      metadata: escrowData
    };
  }

  /**
   * Handle LiqPay webhook
   */
  private async handleLiqPayWebhook(req: Request): Promise<any> {
    const { data, signature } = req.body;

    if (!data || !signature) {
      throw new Error('Missing LiqPay webhook data');
    }

    // Verify signature
    const expectedSignature = this.generateLiqPaySignature(data);
    if (signature !== expectedSignature) {
      throw new Error('Invalid LiqPay webhook signature');
    }

    const webhookData = JSON.parse(Buffer.from(data, 'base64').toString());
    
    const statusMapping: Record<string, string> = {
      success: 'COMPLETED',
      failure: 'FAILED',
      error: 'FAILED',
      reversed: 'REFUNDED'
    };

    return {
      paymentId: webhookData.order_id,
      status: statusMapping[webhookData.status] || 'PENDING',
      transactionId: webhookData.transaction_id,
      metadata: webhookData
    };
  }

  /**
   * Handle cryptocurrency webhook
   */
  private async handleCryptoWebhook(req: Request): Promise<any> {
    const { paymentId, txHash, status, amount } = req.body;

    // In production, verify transaction on blockchain
    if (this.web3Provider && txHash) {
      try {
        const tx = await this.web3Provider.getTransaction(txHash);
        if (!tx) {
          throw new Error('Transaction not found on blockchain');
        }
      } catch (error) {
        logger.warn('Could not verify blockchain transaction', { txHash, error });
      }
    }

    return {
      paymentId,
      status: status === 'confirmed' ? 'COMPLETED' : 'FAILED',
      transactionId: txHash,
      blockchainTxHash: txHash,
      metadata: { amount, confirmedAt: new Date() }
    };
  }

  /**
   * Update payment status in database
   */
  private async updatePaymentStatus(update: any): Promise<any> {
    const updateData: any = {
      status: update.status,
      metadata: update.metadata
    };

    if (update.transactionId) {
      updateData.providerTransactionId = update.transactionId;
    }

    if (update.blockchainTxHash) {
      updateData.blockchainTxHash = update.blockchainTxHash;
    }

    if (update.status === 'COMPLETED') {
      updateData.completedAt = new Date();
    }

    return await prisma.payment.update({
      where: { id: update.paymentId },
      data: updateData,
      include: {
        order: true
      }
    });
  }

  /**
   * Handle successful payment - update order status
   */
  private async handleSuccessfulPayment(payment: any): Promise<void> {
    try {
      // Update order status to APPROVED (paid)
      await prisma.order.update({
        where: { id: payment.orderId },
        data: {
          status: 'APPROVED'
        }
      });

      // Trigger web3 escrow if enabled
      if (payment.method === 'CRYPTOCURRENCY' || payment.method === 'ESCROW') {
        await this.handleWeb3EscrowLock(payment);
      }

      // TODO: Send notifications
      // await notificationService.sendPaymentConfirmation(payment);

      logger.info('Payment processed successfully', {
        paymentId: payment.id,
        orderId: payment.orderId,
        amount: payment.amount
      });

    } catch (error) {
      logger.error('Failed to handle successful payment', {
        paymentId: payment.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle Web3 escrow lock
   */
  private async handleWeb3EscrowLock(payment: any): Promise<void> {
    if (!this.wallet || !PAYMENT_CONFIG.WEB3.ESCROW_ADDRESS) {
      logger.warn('Web3 escrow not configured, skipping escrow lock');
      return;
    }

    try {
      // This would call the PaymentEscrow smart contract
      // const escrowContract = new ethers.Contract(ESCROW_ADDRESS, escrowABI, this.wallet);
      // const tx = await escrowContract.lockPayment(payment.orderId, amount, buyer, seller);
      
      // For now, just log the action
      logger.info('Web3 escrow lock initiated', {
        paymentId: payment.id,
        orderId: payment.orderId,
        amount: payment.amount
      });

    } catch (error) {
      logger.error('Failed to lock payment in escrow', {
        paymentId: payment.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Generate LiqPay signature
   */
  private generateLiqPaySignature(data: string): string {
    const signString = PAYMENT_CONFIG.LIQPAY.PRIVATE_KEY + data + PAYMENT_CONFIG.LIQPAY.PRIVATE_KEY;
    return crypto.createHash('sha1').update(signString).digest('base64');
  }
}