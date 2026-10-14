import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminCampaignsController } from './admin-campaigns.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminRefundsController } from './admin-refunds.controller';
import { AdminNotificationsController } from './admin-notifications.controller';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { RefundsModule } from '../refunds/refunds.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [CampaignsModule, RefundsModule, NotificationsModule],
  controllers: [AdminCampaignsController, AdminUsersController, AdminRefundsController, AdminNotificationsController],
  providers: [AdminService],
})
export class AdminModule {}
