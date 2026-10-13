import { Module } from '@nestjs/common';
import { CampaignsGateway } from './campaigns.gateway';

@Module({
  providers: [CampaignsGateway],
  exports: [CampaignsGateway],
})
export class RealtimeModule {}
