import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignsService } from '../campaigns/campaigns.service';

/**
 * Releases reservations for checkouts that never completed payment. This is
 * currently the only place anything ever moves an Order to CANCELLED.
 *
 * Expiry is at the OrderGroup level, not the individual Order level (see
 * TASKS.md 1.6): a multi-campaign cart checkout is one payment, so if it
 * times out, every order under that group must expire together, not just
 * whichever one happens to be scanned first.
 */
@Injectable()
export class OrderExpiryService {
  private readonly logger = new Logger(OrderExpiryService.name);
  private readonly windowMinutes = Number(process.env.ORDER_EXPIRY_MINUTES ?? 15);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireStalePendingOrders() {
    const cutoff = new Date(Date.now() - this.windowMinutes * 60_000);
    const touchedCampaignIds = new Set<string>();

    const staleGroups = await this.prisma.orderGroup.findMany({
      where: { status: OrderStatus.PENDING_PAYMENT, createdAt: { lt: cutoff } },
      include: { orders: true },
    });
    for (const group of staleGroups) {
      await this.prisma.$transaction(async (tx) => {
        for (const order of group.orders) {
          if (order.status !== OrderStatus.PENDING_PAYMENT) continue;
          await tx.campaign.update({
            where: { id: order.campaignId },
            data: { bookedUnits: { decrement: order.quantity } },
          });
          await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.CANCELLED } });
          touchedCampaignIds.add(order.campaignId);
        }
        await tx.orderGroup.update({ where: { id: group.id }, data: { status: OrderStatus.CANCELLED } });
      });
    }

    const staleStandaloneOrders = await this.prisma.order.findMany({
      where: { status: OrderStatus.PENDING_PAYMENT, orderGroupId: null, createdAt: { lt: cutoff } },
    });
    for (const order of staleStandaloneOrders) {
      await this.prisma.$transaction(async (tx) => {
        await tx.campaign.update({
          where: { id: order.campaignId },
          data: { bookedUnits: { decrement: order.quantity } },
        });
        await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.CANCELLED } });
      });
      touchedCampaignIds.add(order.campaignId);
    }

    for (const campaignId of touchedCampaignIds) {
      await this.campaigns.broadcastState(campaignId);
    }

    if (staleGroups.length || staleStandaloneOrders.length) {
      this.logger.log(
        `Expired ${staleGroups.length} order group(s) and ${staleStandaloneOrders.length} standalone order(s) past the ${this.windowMinutes}-minute payment window`,
      );
    }
  }
}
