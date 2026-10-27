import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RefundStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RefundJobData } from '../jobs/refunds.processor';

@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('refunds') private readonly refundsQueue: Queue<RefundJobData>,
  ) {}

  /** Buyer-facing — only this user's own refunds, joined through their orders. */
  async myRefunds(userId: string) {
    return this.prisma.refund.findMany({
      where: { order: { userId } },
      include: { order: { include: { campaign: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Admin-facing — every refund on the platform, optionally filtered. */
  async adminList(params: { status?: RefundStatus; campaignId?: string; userId?: string }) {
    return this.prisma.refund.findMany({
      where: {
        ...(params.status && { status: params.status }),
        ...((params.campaignId || params.userId) && {
          order: {
            ...(params.campaignId && { campaignId: params.campaignId }),
            ...(params.userId && { userId: params.userId }),
          },
        }),
      },
      include: { order: { include: { campaign: true, user: { select: { id: true, name: true, phone: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Admin-triggered refund outside the automatic price-unlock reconciliation
   * (e.g. a complaint-driven refund). Reuses the same queue/processor the
   * automatic path uses rather than calling Razorpay synchronously inline.
   */
  async manualRefund(orderId: string, amount: number, reason: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    const refund = await this.prisma.refund.create({
      data: { orderId, amount, reason, status: RefundStatus.PENDING },
    });
    await this.refundsQueue.add('process-refund', { refundId: refund.id });
    return refund;
  }

  async retry(refundId: string) {
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!refund) throw new NotFoundException('Refund not found');

    const updated = await this.prisma.refund.update({
      where: { id: refundId },
      data: { status: RefundStatus.PENDING },
    });
    await this.refundsQueue.add('process-refund', { refundId: updated.id });
    return updated;
  }
}
