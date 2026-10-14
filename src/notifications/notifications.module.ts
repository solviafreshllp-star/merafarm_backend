import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway],
  exports: [NotificationsService],
})
export class NotificationsModule {}
