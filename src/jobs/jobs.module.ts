import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RefundsProcessor } from './refunds.processor';
import { OrderExpiryService } from './order-expiry.service';
import { RazorpayService } from '../payments/razorpay.service';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    CampaignsModule,
    NotificationsModule,
    BullModule.registerQueue({
      name: 'refunds',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }),
  ],
  providers: [RefundsProcessor, OrderExpiryService, RazorpayService],
  exports: [BullModule],
})
export class JobsModule {}
