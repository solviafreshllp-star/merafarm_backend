import { BadRequestException, Controller, Headers, Logger, Post, RawBodyRequest, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { RazorpayService } from './razorpay.service';
import { OrdersService } from '../orders/orders.service';
import { CheckoutService } from '../cart/checkout.service';

/**
 * Authoritative, server-to-server confirmation of a payment — independent
 * of whether the buyer's browser ever calls back. Until this existed,
 * confirming an order relied entirely on the client hitting
 * `POST /orders/:id/confirm-payment` (or `/checkout/:groupId/confirm`)
 * after Razorpay Checkout's JS callback fired. If the buyer's connection
 * drops, the tab closes, or the app crashes in that gap, Razorpay has
 * already captured the money but the order sits in PENDING_PAYMENT
 * forever with nothing to reconcile it — this endpoint is the backstop for
 * exactly that case. The browser-driven confirm stays (it's faster for the
 * buyer's own UX); this is what makes confirmation actually reliable.
 *
 * Not behind JwtAuthGuard — Razorpay calls this directly, authenticated by
 * HMAC signature (`verifyWebhookSignature`) instead of a user's JWT.
 *
 * Register this URL (`<your domain>/api/payments/webhook`) in the Razorpay
 * dashboard's webhook settings, subscribed to at least `payment.captured`,
 * with RAZORPAY_WEBHOOK_SECRET set to the same secret shown there. Razorpay
 * can't reach a localhost dev server directly — use a tunnel (ngrok etc.)
 * if you need to exercise this against real Razorpay test-mode webhooks
 * before deploying somewhere publicly reachable.
 */
@Controller('payments')
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(
    private readonly razorpay: RazorpayService,
    private readonly orders: OrdersService,
    private readonly checkout: CheckoutService,
  ) {}

  @Post('webhook')
  async handleWebhook(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature?: string) {
    if (!req.rawBody) throw new BadRequestException('Missing raw request body');
    if (!signature) throw new UnauthorizedException('Missing webhook signature');

    const valid = this.razorpay.verifyWebhookSignature(req.rawBody.toString('utf8'), signature);
    if (!valid) throw new UnauthorizedException('Invalid webhook signature');

    const event = req.body?.event;

    if (event === 'payment.captured') {
      const payment = req.body?.payload?.payment?.entity;
      const razorpayOrderId: string | undefined = payment?.order_id;
      const paymentId: string | undefined = payment?.id;

      if (razorpayOrderId && paymentId) {
        await this.confirmByRazorpayOrderId(razorpayOrderId, paymentId);
      } else {
        this.logger.warn('payment.captured webhook missing order_id/payment id in payload');
      }
    }
    // Other event types (payment.failed, refund.*) aren't acted on here —
    // a failed/abandoned payment just leaves the order PENDING_PAYMENT,
    // which the existing OrderExpiryService already cleans up on its own.

    // Always acknowledge with 2xx once we've either handled the event or
    // deliberately ignored one we don't act on — Razorpay retries on
    // anything else, and we don't want retries for events we're skipping
    // on purpose.
    return { ok: true };
  }

  /** Tries the single-order path first, then the cart/group path — a given
   *  Razorpay order id belongs to exactly one of the two. */
  private async confirmByRazorpayOrderId(razorpayOrderId: string, paymentId: string) {
    const order = await this.orders.confirmOrderByRazorpayOrderId(razorpayOrderId, paymentId);
    if (order) return;

    const group = await this.checkout.confirmGroupByRazorpayOrderId(razorpayOrderId, paymentId);
    if (!group) {
      this.logger.warn(`payment.captured webhook for unrecognized Razorpay order ${razorpayOrderId}`);
    }
  }
}
