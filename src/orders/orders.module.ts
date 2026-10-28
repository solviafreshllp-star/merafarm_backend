import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { CampaignCloseService } from './campaign-close.service';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { JobsModule } from '../jobs/jobs.module';
import { RazorpayService } from '../payments/razorpay.service';

@Module({
  imports: [CampaignsModule, JobsModule],
  controllers: [OrdersController],
  providers: [OrdersService, RazorpayService, CampaignCloseService],
  exports: [OrdersService],
})
export class OrdersModule {}
