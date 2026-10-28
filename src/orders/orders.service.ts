import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OrderStatus, RefundStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { RazorpayService } from '../payments/razorpay.service';
import { currentPrice } from '../campaigns/pricing.util';
import { CreateOrderDto, ConfirmPaymentDto } from './dto/order.dto';
import { RefundJobData } from '../jobs/refunds.processor';
import { resolveOrderAddress } from './address-scope.util';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly razorpay: RazorpayService,
    @InjectQueue('refunds') private readonly refundsQueue: Queue<RefundJobData>,
  ) {}

  async createOrder(userId: string, dto: CreateOrderDto) {
    const campaignRow = await this.prisma.campaign.findUnique({ where: { id: dto.campaignId } });
    if (!campaignRow) throw new NotFoundException('Campaign not found');

    // Reserve units first — this is the transactional, race-safe step that
    // both locks in the buyer's slot against the cap and tells us the
    // exact price THIS order's own quantity unlocks (see pricing.util.ts).
    const { unitPrice } = await this.campaigns.reserveUnits(dto.campaignId, dto.quantity);
    const amount = unitPrice * dto.quantity;

    const referralLink = dto.referralCode
      ? await this.prisma.referralLink.findUnique({ where: { code: dto.referralCode } })
      : null;

    const orderNumber = 'ORD' + Math.floor(100000 + Math.random() * 900000);
    const address = resolveOrderAddress(campaignRow, dto);

    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        userId,
        campaignId: dto.campaignId,
        quantity: dto.quantity,
        unitPriceCharged: unitPrice,
        amount,
        status: OrderStatus.PENDING_PAYMENT,
        ...address,
        referralLinkId: referralLink?.id,
      },
    });

    const razorpayOrder = await this.razorpay.createOrder(amount, orderNumber);

    return {
      order,
      razorpayOrderId: razorpayOrder.id,
      amount,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID,
    };
  }

  async confirmPayment(userId: string, orderId: string, dto: ConfirmPaymentDto) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('Not your order');
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException(`Order is already ${order.status}`);
    }

    const valid = this.razorpay.verifyPaymentSignature(
      dto.razorpayOrderId,
      dto.razorpayPaymentId,
      dto.razorpaySignature,
    );
    if (!valid) throw new BadRequestException('Payment signature verification failed');

    const confirmed = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.CONFIRMED, paymentRef: dto.razorpayPaymentId },
    });

    if (order.referralLinkId) {
      await this.prisma.referralEvent.create({
        data: {
          referralLinkId: order.referralLinkId,
          type: 'ORDER_PLACED',
          unitsAdded: order.quantity,
        },
      });
    }

    // Refunds are settled once, in a lump sum, when the campaign's preorder
    // window closes (see finalizeRefundsForCampaign / CampaignCloseService)
    // — not here on every confirm — so just keep the live price/booked-count
    // ticker in sync for buyers still browsing.
    await this.campaigns.broadcastState(order.campaignId);

    return confirmed;
  }

  async myOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      include: { campaign: true, refunds: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Runs once — when a campaign's preorder window closes (see
   * CampaignCloseService, which calls this right after flipping the
   * campaign to CLOSED) — and settles every buyer's refund in a single
   * lump sum against the campaign's final price, instead of one small
   * refund per price drop during the window. That used to fire on every
   * order confirmation (see git history), which meant a buyer who ordered
   * early could rack up several tiny refunds as later buyers unlocked each
   * successive tier; batching it here means one refund reflecting the
   * group's best final price, which is both simpler for a buyer to make
   * sense of and cheaper to process than N small ones.
   *
   * Idempotent — only tops up whatever isn't already covered by a refund
   * on that order (relevant for orders that already got a partial refund
   * from before this moved to close-time-only).
   *
   * Each order's refund is isolated in its own try/catch: one failure
   * (e.g. a transient queue/DB hiccup) must not stop the rest of the
   * campaign's buyers from being settled in the same pass.
   */
  async finalizeRefundsForCampaign(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
    });
    if (!campaign) return;

    const confirmedUnits = await this.campaigns.confirmedUnitsFor(campaignId);
    const finalPrice = currentPrice(campaign.slabs, confirmedUnits);

    const confirmedOrders = await this.prisma.order.findMany({
      where: { campaignId, status: OrderStatus.CONFIRMED, unitPriceCharged: { gt: finalPrice } },
      include: { refunds: true },
    });

    for (const order of confirmedOrders) {
      try {
        const alreadyRefunded = order.refunds.reduce((sum, r) => sum + r.amount, 0);
        const fullEntitlement = (order.unitPriceCharged - finalPrice) * order.quantity;
        const additional = fullEntitlement - alreadyRefunded;
        if (additional <= 0) continue;

        const refund = await this.prisma.refund.create({
          data: {
            orderId: order.id,
            amount: additional,
            reason: `Final group price was ₹${finalPrice}/${campaign.unitLabel} when the preorder window closed`,
            status: RefundStatus.PENDING,
          },
        });

        await this.refundsQueue.add('process-refund', { refundId: refund.id });
      } catch (err) {
        this.logger.error(`Could not settle refund for order ${order.orderNumber} (campaign ${campaignId})`, err as Error);
      }
    }
  }
}
