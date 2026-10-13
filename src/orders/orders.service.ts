import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OrderStatus, RefundStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { RazorpayService } from '../payments/razorpay.service';
import { currentPrice } from '../campaigns/pricing.util';
import { CreateOrderDto, ConfirmPaymentDto } from './dto/order.dto';
import { RefundJobData } from '../jobs/refunds.processor';

@Injectable()
export class OrdersService {
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

    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        userId,
        campaignId: dto.campaignId,
        quantity: dto.quantity,
        unitPriceCharged: unitPrice,
        amount,
        status: OrderStatus.PENDING_PAYMENT,
        // Address fields ABOVE the campaign's scope depth always come from
        // the campaign itself — never from client input — so a buyer can
        // never spoof a cheaper or mismatched delivery scope. Fields below
        // the depth come from what they typed.
        addressCity: campaignRow.scopeCity ?? '',
        addressPincode: campaignRow.scopePincode ?? '',
        addressLocality: campaignRow.scopeLocality ?? '',
        addressSociety: campaignRow.scopeSociety ?? dto.flat, // NATIONAL/CITY-scope campaigns have no society on file
        addressFlat: dto.flat,
        addressWing: dto.wing,
        addressLandmark: dto.landmark,
        deliveryNote: dto.deliveryNote,
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

    // This order may have just unlocked a lower tier for OTHER buyers who
    // already paid more — reconcile automatic refunds for them now.
    await this.reconcileRefundsForCampaign(order.campaignId);

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
   * The automatic-refund half of the "no refund needed for your own order"
   * rule: whenever a campaign's booked units change (i.e. right after any
   * order is confirmed), find every other CONFIRMED order on that campaign
   * that paid more than the campaign's current price and top up a refund
   * for the difference. Idempotent — safe to call repeatedly as the price
   * keeps dropping, since it only refunds the incremental difference not
   * already covered by a prior refund on that order.
   */
  async reconcileRefundsForCampaign(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
    });
    if (!campaign) return;

    const nowPrice = currentPrice(campaign.slabs, campaign.bookedUnits);

    const confirmedOrders = await this.prisma.order.findMany({
      where: { campaignId, status: OrderStatus.CONFIRMED, unitPriceCharged: { gt: nowPrice } },
      include: { refunds: true },
    });

    for (const order of confirmedOrders) {
      const alreadyRefunded = order.refunds.reduce((sum, r) => sum + r.amount, 0);
      const fullEntitlement = (order.unitPriceCharged - nowPrice) * order.quantity;
      const additional = fullEntitlement - alreadyRefunded;
      if (additional <= 0) continue;

      const refund = await this.prisma.refund.create({
        data: {
          orderId: order.id,
          amount: additional,
          reason: `Group unlocked ₹${nowPrice}/${campaign.unitLabel} after this order was placed`,
          status: RefundStatus.PENDING,
        },
      });

      await this.refundsQueue.add('process-refund', { refundId: refund.id });
    }
  }
}
