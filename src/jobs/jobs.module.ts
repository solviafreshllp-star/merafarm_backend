import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RefundsProcessor } from './refunds.processor';
import { RazorpayService } from '../payments/razorpay.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'refunds',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }),
  ],
  providers: [RefundsProcessor, RazorpayService],
  exports: [BullModule],
})
export class JobsModule {}
