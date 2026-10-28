import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RazorpayService } from '../payments/razorpay.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RefundStatus } from '@prisma/client';

export interface RefundJobData {
  refundId: string;
}

@Processor('refunds')
export class RefundsProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<RefundJobData>) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: job.data.refundId },
      include: { order: { include: { campaign: true } } },
    });
    if (!refund || refund.status !== RefundStatus.PENDING) return;
    if (!refund.order.paymentRef) {
      // No captured payment to refund against yet — shouldn't happen for a
      // CONFIRMED order, but bail safely rather than throw against Razorpay.
      return;
    }

    try {
      await this.razorpay.refundPayment(refund.order.paymentRef, refund.amount);
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { status: RefundStatus.PROCESSED },
      });

      await this.notifications.notify(
        refund.order.userId,
        'REFUND_STATUS',
        'Refund processed',
        `₹${refund.amount.toLocaleString('en-IN')} for your ${refund.order.campaign.productName} order (#${refund.order.orderNumber}) has been refunded — it should reflect in your account within 5–7 business days.`,
      );
    } catch (err) {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { status: RefundStatus.FAILED },
      });
      throw err; // let BullMQ retry per the queue's retry policy
    }
  }
}
