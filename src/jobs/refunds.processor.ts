import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RazorpayService } from '../payments/razorpay.service';
import { RefundStatus } from '@prisma/client';

export interface RefundJobData {
  refundId: string;
}

@Processor('refunds')
export class RefundsProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
  ) {
    super();
  }

  async process(job: Job<RefundJobData>) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: job.data.refundId },
      include: { order: true },
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
    } catch (err) {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { status: RefundStatus.FAILED },
      });
      throw err; // let BullMQ retry per the queue's retry policy
    }
  }
}
