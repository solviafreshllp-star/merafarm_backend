import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { OrdersService } from '../orders/orders.service';
import { RazorpayService } from '../payments/razorpay.service';
import { resolveOrderAddress } from '../orders/address-scope.util';
import { CheckoutDto, ConfirmCheckoutDto } from './dto/checkout.dto';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly orders: OrdersService,
    private readonly razorpay: RazorpayService,
  ) {}

  /**
   * One Razorpay order for the summed amount, one OrderGroup, N child
   * Orders — all reserved atomically in a single transaction. If any
   * campaign in the cart is sold out or no longer LIVE, the whole checkout
   * fails and nothing partially reserves (see TASKS.md 1.6).
   */
  async checkout(userId: string, dto: CheckoutDto) {
    const cart = await this.prisma.cart.findUnique({ where: { userId }, include: { items: true } });
    if (!cart || cart.items.length === 0) throw new BadRequestException('Your cart is empty');

    const result = await this.prisma.$transaction(async (tx) => {
      const group = await tx.orderGroup.create({ data: { userId, status: OrderStatus.PENDING_PAYMENT } });

      let totalAmount = 0;
      const createdOrders = [];
      for (const item of cart.items) {
        const campaignRow = await tx.campaign.findUnique({ where: { id: item.campaignId } });
        if (!campaignRow) throw new NotFoundException(`Campaign ${item.campaignId} not found`);

        // Same reservation logic as the single-order checkout (cap check +
        // slab pricing + bookedUnits bump) — shares THIS transaction
        // instead of opening its own, so one sold-out campaign in the cart
        // rolls back every other reservation in the same checkout too.
        const { unitPrice } = await this.campaigns.reserveUnits(item.campaignId, item.quantity, tx);
        const amount = unitPrice * item.quantity;
        totalAmount += amount;

        const address = resolveOrderAddress(campaignRow, dto.address);
        const orderNumber = 'ORD' + Math.floor(100000 + Math.random() * 900000);

        const order = await tx.order.create({
          data: {
            orderNumber,
            userId,
            campaignId: item.campaignId,
            quantity: item.quantity,
            unitPriceCharged: unitPrice,
            amount,
            status: OrderStatus.PENDING_PAYMENT,
            orderGroupId: group.id,
            ...address,
          },
        });
        createdOrders.push(order);
      }

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return { group, orders: createdOrders, totalAmount };
    });

    const razorpayOrder = await this.razorpay.createOrder(result.totalAmount, result.group.id);
    await this.prisma.orderGroup.update({
      where: { id: result.group.id },
      data: { razorpayOrderId: razorpayOrder.id },
    });

    // Broadcast every touched campaign's new state only now that the
    // reservation transaction has actually committed.
    const campaignIds = [...new Set(result.orders.map((o) => o.campaignId))];
    for (const campaignId of campaignIds) await this.campaigns.broadcastState(campaignId);

    return {
      orderGroupId: result.group.id,
      razorpayOrderId: razorpayOrder.id,
      amount: result.totalAmount,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID,
    };
  }

  /** Verifies the Razorpay signature once, then confirms every Order under the group in one transaction. */
  async confirm(userId: string, groupId: string, dto: ConfirmCheckoutDto) {
    const group = await this.prisma.orderGroup.findUnique({ where: { id: groupId }, include: { orders: true } });
    if (!group) throw new NotFoundException('Order group not found');
    if (group.userId !== userId) throw new ForbiddenException('Not your order group');
    if (group.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException(`Order group is already ${group.status}`);
    }

    const valid = this.razorpay.verifyPaymentSignature(
      dto.razorpayOrderId,
      dto.razorpayPaymentId,
      dto.razorpaySignature,
    );
    if (!valid) throw new BadRequestException('Payment signature verification failed');

    await this.prisma.$transaction(async (tx) => {
      for (const order of group.orders) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.CONFIRMED, paymentRef: dto.razorpayPaymentId },
        });
      }
      await tx.orderGroup.update({ where: { id: group.id }, data: { status: OrderStatus.CONFIRMED } });
    });

    // Refund reconciliation is per-order/per-campaign (unchanged) — the
    // group is only the checkout/payment unit, not the refund unit.
    const campaignIds = [...new Set(group.orders.map((o) => o.campaignId))];
    for (const campaignId of campaignIds) {
      await this.orders.reconcileRefundsForCampaign(campaignId);
    }

    return this.prisma.orderGroup.findUnique({ where: { id: group.id }, include: { orders: true } });
  }
}
