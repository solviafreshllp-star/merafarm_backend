import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/upsert-address.dto';

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
            { id: filters.q },
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

  /** Profile view for a single customer — core fields plus their saved
   *  address book, for the admin "customer 360" screen. Order/complaint/
   *  refund history are separate calls (getUserOrders etc) so each tab on
   *  that screen can load independently instead of one slow joined query. */
  async getUserDetail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        isSeller: true,
        isAdmin: true,
        isSuspended: true,
        createdAt: true,
        addressBook: {
          select: { id: true, flat: true, wing: true, landmark: true, note: true, isDefault: true, lat: true, lng: true },
          orderBy: { isDefault: 'desc' },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Every order this user has ever placed, across every seller/campaign —
   *  no admin-facing equivalent existed before (only a seller's own
   *  `GET /campaigns/:id/orders`). */
  async getUserOrders(id: string) {
    return this.prisma.order.findMany({
      where: { userId: id },
      include: { campaign: { select: { productName: true, farmName: true, unitLabel: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Admin-recorded address for a customer (e.g. taken down on a support
   *  call) — there's no buyer-facing "save an address" flow yet (checkout
   *  takes a fresh address every time), so this is currently the only way
   *  an Address row gets created. `lat`/`lng` are the map pin, parsed on
   *  the frontend from a pasted Google Maps link. */
  async createAddress(userId: string, dto: CreateAddressDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.address.create({
        data: {
          userId,
          flat: dto.flat,
          wing: dto.wing,
          landmark: dto.landmark,
          note: dto.note,
          isDefault: dto.isDefault ?? false,
          lat: dto.lat,
          lng: dto.lng,
        },
        select: { id: true, flat: true, wing: true, landmark: true, note: true, isDefault: true, lat: true, lng: true },
      });
    });
  }

  async updateAddress(userId: string, addressId: string, dto: UpdateAddressDto) {
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.userId !== userId) throw new NotFoundException('Address not found');

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.address.updateMany({ where: { userId, isDefault: true, NOT: { id: addressId } }, data: { isDefault: false } });
      }
      return tx.address.update({
        where: { id: addressId },
        data: {
          ...(dto.flat !== undefined && { flat: dto.flat }),
          ...(dto.wing !== undefined && { wing: dto.wing }),
          ...(dto.landmark !== undefined && { landmark: dto.landmark }),
          ...(dto.note !== undefined && { note: dto.note }),
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
          ...(dto.lat !== undefined && { lat: dto.lat }),
          ...(dto.lng !== undefined && { lng: dto.lng }),
        },
        select: { id: true, flat: true, wing: true, landmark: true, note: true, isDefault: true, lat: true, lng: true },
      });
    });
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.isSeller !== undefined && { isSeller: dto.isSeller }),
        ...(dto.isAdmin !== undefined && { isAdmin: dto.isAdmin }),
        ...(dto.isSuspended !== undefined && { isSuspended: dto.isSuspended }),
      },
      select: { id: true, name: true, phone: true, email: true, isSeller: true, isAdmin: true, isSuspended: true },
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
