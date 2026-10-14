import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly admin: AdminService) {}

  @Post()
  broadcast(@CurrentUser() user: JwtPayload, @Body() dto: BroadcastNotificationDto) {
    return this.admin.broadcastNotification(user.sub, dto);
  }
}
