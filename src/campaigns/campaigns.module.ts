import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { CloudflareImagesService } from '../media/cloudflare-images.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [RealtimeModule, NotificationsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CloudflareImagesService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
