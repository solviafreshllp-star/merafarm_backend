import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('me')
  mine(@CurrentUser() user: JwtPayload) {
    return this.notifications.myNotifications(user.sub);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.notifications.markRead(id, user.sub);
  }
}
