import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Minimal audit trail (see TASKS.md 1.11) — every admin action a seller
   * could later dispute ("why did my price change") gets a row here.
   */
  async logAction(adminUserId: string, action: string, targetType: string, targetId: string, changes?: unknown) {
    await this.prisma.auditLog.create({
      data: { adminUserId, action, targetType, targetId, changes: changes as Prisma.InputJsonValue },
    });
  }

  async listUsers(filters: { isSeller?: boolean; isAdmin?: boolean; q?: string }) {
    return this.prisma.user.findMany({
      where: {
        ...(filters.isSeller !== undefined && { isSeller: filters.isSeller }),
        ...(filters.isAdmin !== undefined && { isAdmin: filters.isAdmin }),
        ...(filters.q && {
          OR: [
            { name: { contains: filters.q, mode: 'insensitive' } },
            { phone: { contains: filters.q } },
          ],
        }),
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        isSeller: true,
        isAdmin: true,
        isSuspended: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.isSeller !== undefined && { isSeller: dto.isSeller }),
        ...(dto.isAdmin !== undefined && { isAdmin: dto.isAdmin }),
        ...(dto.isSuspended !== undefined && { isSuspended: dto.isSuspended }),
      },
      select: { id: true, name: true, phone: true, isSeller: true, isAdmin: true, isSuspended: true },
    });
  }

  /** Fan out as Notification rows + a socket emit to each affected user, per TASKS.md 1.14. */
  async broadcastNotification(adminUserId: string, dto: BroadcastNotificationDto) {
    let userIds: string[];
    if (dto.campaignId) {
      const [orders, links] = await Promise.all([
        this.prisma.order.findMany({ where: { campaignId: dto.campaignId }, select: { userId: true } }),
        this.prisma.referralLink.findMany({ where: { campaignId: dto.campaignId }, select: { userId: true } }),
      ]);
      userIds = [...new Set([...orders.map((o) => o.userId), ...links.map((l) => l.userId)])];
    } else {
      const all = await this.prisma.user.findMany({ select: { id: true } });
      userIds = all.map((u) => u.id);
    }

    const result = await this.notifications.notifyMany(userIds, 'ADMIN_BROADCAST', dto.title, dto.body);
    await this.logAction(adminUserId, 'notification.broadcast', dto.campaignId ? 'Campaign' : 'User', dto.campaignId ?? 'all', {
      title: dto.title,
      recipientCount: userIds.length,
    });
    return result;
  }
}
