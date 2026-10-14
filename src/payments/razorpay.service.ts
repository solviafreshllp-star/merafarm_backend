import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';

@Injectable()
export class RazorpayService {
  private client: Razorpay;

  constructor() {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET environment variables are not set');
    }
    this.client = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }

  /** amountRupees is whole rupees — Razorpay wants paise. */
  async createOrder(amountRupees: number, receipt: string) {
    return this.client.orders.create({
      amount: amountRupees * 100,
      currency: 'INR',
      receipt,
    });
  }

  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET ?? '')
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return expected === signature;
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET ?? '')
      .update(rawBody)
      .digest('hex');
    return expected === signature;
  }

  /** Called by the refund worker once a price-drop refund is approved. */
  async refundPayment(paymentId: string, amountRupees: number) {
    return this.client.payments.refund(paymentId, { amount: amountRupees * 100 });
  }
}
