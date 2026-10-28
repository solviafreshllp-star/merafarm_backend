import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CampaignStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { OrdersService } from './orders.service';

/**
 * Closes a LIVE campaign once its preorder window (endAt) has passed, and
 * settles every buyer's refund in one lump sum right after — see
 * OrdersService.finalizeRefundsForCampaign's doc comment for why refunds
 * moved here instead of firing on every order confirmation during the
 * window. Same polling-cron shape as OrderExpiryService, for the same
 * reason: nothing else currently drives a campaign status transition off
 * the clock.
 */
@Injectable()
export class CampaignCloseService {
  private readonly logger = new Logger(CampaignCloseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly orders: OrdersService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async closeExpiredCampaigns() {
    const now = new Date();

    const dueCampaigns = await this.prisma.campaign.findMany({
      where: { status: CampaignStatus.LIVE, endAt: { lte: now } },
      select: { id: true },
    });
    for (const campaign of dueCampaigns) {
      await this.prisma.campaign.update({ where: { id: campaign.id }, data: { status: CampaignStatus.CLOSED } });
    }

    // Re-attempt settlement for everything that closed in the last day, not
    // just whatever closed on THIS tick. finalizeRefundsForCampaign is
    // idempotent and cheap (a no-op once nothing's owed), so this is free
    // insurance: if a process restart or crash ever interrupts a previous
    // tick's settlement loop partway through (the exact failure mode that
    // silently under-refunded buyers before this cron even existed), the
    // very next tick finishes the job instead of leaving it stuck forever
    // with nothing left to retry it.
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const toSettle = await this.prisma.campaign.findMany({
      where: { status: CampaignStatus.CLOSED, endAt: { gte: oneDayAgo } },
      select: { id: true },
    });

    for (const campaign of toSettle) {
      await this.orders.finalizeRefundsForCampaign(campaign.id);
      await this.campaigns.broadcastState(campaign.id);
    }

    if (dueCampaigns.length) {
      this.logger.log(`Closed ${dueCampaigns.length} campaign(s) past their preorder window; settled ${toSettle.length} recently-closed campaign(s).`);
    }
  }
}
