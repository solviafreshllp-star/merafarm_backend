import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  /** Fan-out primitive every other feature's notifications go through — see TASKS.md 1.14. */
  async notify(userId: string, type: string, title: string, body: string) {
    const notification = await this.prisma.notification.create({
      data: { userId, type, title, body },
    });
    this.gateway.notifyUser(userId, notification);
    return notification;
  }

  async notifyMany(userIds: string[], type: string, title: string, body: string) {
    const uniqueIds = [...new Set(userIds)];
    await this.prisma.notification.createMany({
      data: uniqueIds.map((userId) => ({ userId, type, title, body })),
    });
    // createMany doesn't return rows — re-fetch just what we need to push over the socket.
    const created = await this.prisma.notification.findMany({
      where: { userId: { in: uniqueIds }, type, title, body },
      orderBy: { createdAt: 'desc' },
      take: uniqueIds.length,
    });
    for (const notification of created) {
      this.gateway.notifyUser(notification.userId, notification);
    }
    return { count: uniqueIds.length };
  }

  async myNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new NotFoundException('Notification not found');
    if (notification.userId !== userId) throw new ForbiddenException('Not your notification');
    return this.prisma.notification.update({ where: { id }, data: { read: true } });
  }
}
