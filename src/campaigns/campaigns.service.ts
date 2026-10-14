import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Campaign, CampaignStatus, Prisma, PriceSlab } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCapDto } from './dto/update-cap.dto';
import { AdminUpdateCampaignDto } from './dto/admin-update-campaign.dto';
import { chargePriceFor, currentPrice, nextSlabInfo } from './pricing.util';
import { CampaignsGateway } from '../realtime/campaigns.gateway';
import { NotificationsService } from '../notifications/notifications.service';

type TxClient = Prisma.TransactionClient;

type CampaignWithSlabs = Campaign & { slabs: PriceSlab[] };

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: CampaignsGateway,
    private readonly notifications: NotificationsService,
  ) {}

  async create(sellerId: string, dto: CreateCampaignDto) {
    const sortedSlabs = [...dto.slabs].sort((a, b) => a.fromQty - b.fromQty);

    return this.prisma.campaign.create({
      data: {
        productName: dto.productName,
        description: dto.description,
        farmName: dto.farmName,
        unitLabel: dto.unitLabel ?? 'dozen',
        sellerId,
        scopeType: dto.scopeType,
        scopeCity: dto.scopeCity,
        scopePincode: dto.scopePincode,
        scopeLocality: dto.scopeLocality,
        scopeSociety: dto.scopeSociety,
        capUnits: dto.capUnits,
        startAt: new Date(dto.startAt),
        endAt: new Date(dto.endAt),
        status: CampaignStatus.DRAFT,
        slabs: { create: sortedSlabs },
      },
      include: { slabs: true },
    });
  }

  async findLive(params: { city?: string; category?: string } = {}) {
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: CampaignStatus.LIVE,
        ...(params.city ? { scopeCity: params.city } : {}),
      },
      include: { slabs: true },
      orderBy: { createdAt: 'desc' },
    });
    return campaigns.map((c) => this.toSummary(c));
  }

  async findOne(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return this.toDetail(campaign);
  }

  /** Editable any time — including after the campaign has gone live. */
  async updateCap(id: string, sellerId: string, dto: UpdateCapDto) {
    const campaign = await this.requireOwnedCampaign(id, sellerId);
    return this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { capUnits: dto.capUnits },
      include: { slabs: true },
    });
  }

  /**
   * Submit-for-review, not publish: a seller's "go live" action now lands
   * in PENDING_REVIEW and waits on an admin approve/reject decision (see
   * TASKS.md 1.10). The route/method name stayed the same even though the
   * destination status changed, since the frontend action is still "I'm
   * done editing, send this out" from the seller's point of view.
   */
  async goLive(id: string, sellerId: string) {
    const campaign = await this.requireOwnedCampaign(id, sellerId);
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new ForbiddenException('Only a draft campaign can be submitted for review');
    }
    return this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: CampaignStatus.PENDING_REVIEW, rejectionReason: null },
    });
  }

  /** Seller's own campaigns across every status — the seller dashboard list. */
  async findMine(sellerId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { sellerId },
      include: { slabs: true },
      orderBy: { createdAt: 'desc' },
    });
    return campaigns.map((c) => this.toDetail(c));
  }

  /** Orders against one of the seller's own campaigns — the fulfillment view. */
  async findOrdersFor(campaignId: string, sellerId: string) {
    await this.requireOwnedCampaign(campaignId, sellerId);
    return this.prisma.order.findMany({
      where: { campaignId },
      include: { user: { select: { id: true, name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approve(id: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== CampaignStatus.PENDING_REVIEW) {
      throw new ForbiddenException('Only a campaign pending review can be approved');
    }
    return this.prisma.campaign.update({ where: { id }, data: { status: CampaignStatus.LIVE } });
  }

  /** Reverts to DRAFT (not a dead-end REJECTED status) so the seller can edit and resubmit. */
  async reject(id: string, reason: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== CampaignStatus.PENDING_REVIEW) {
      throw new ForbiddenException('Only a campaign pending review can be rejected');
    }
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.DRAFT, rejectionReason: reason },
    });
    await this.notifications.notify(
      campaign.sellerId,
      'CAMPAIGN_REJECTED',
      'Your campaign needs changes',
      `"${campaign.productName}" was sent back to drafts: ${reason}`,
    );
    return updated;
  }

  /**
   * Full-edit endpoint for admins — bypasses the seller-ownership check the
   * seller's own PATCH endpoints enforce. Caller (AdminController) is
   * responsible for writing the AuditLog row; this method only applies the
   * change.
   */
  async adminUpdate(id: string, dto: AdminUpdateCampaignDto) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');

    return this.prisma.campaign.update({
      where: { id },
      data: {
        ...(dto.productName !== undefined && { productName: dto.productName }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.farmName !== undefined && { farmName: dto.farmName }),
        ...(dto.unitLabel !== undefined && { unitLabel: dto.unitLabel }),
        ...(dto.scopeType !== undefined && { scopeType: dto.scopeType }),
        ...(dto.scopeCity !== undefined && { scopeCity: dto.scopeCity }),
        ...(dto.scopePincode !== undefined && { scopePincode: dto.scopePincode }),
        ...(dto.scopeLocality !== undefined && { scopeLocality: dto.scopeLocality }),
        ...(dto.scopeSociety !== undefined && { scopeSociety: dto.scopeSociety }),
        ...(dto.capUnits !== undefined && { capUnits: dto.capUnits }),
        ...(dto.startAt !== undefined && { startAt: new Date(dto.startAt) }),
        ...(dto.endAt !== undefined && { endAt: new Date(dto.endAt) }),
        ...(dto.slabs !== undefined && {
          slabs: {
            deleteMany: {},
            create: [...dto.slabs].sort((a, b) => a.fromQty - b.fromQty),
          },
        }),
      },
      include: { slabs: true },
    });
  }

  /**
   * Atomically bumps bookedUnits and returns the price this specific order
   * quantity unlocks. Wrapped in a transaction with row locking so two
   * checkouts racing near a threshold can't both be promised a price the
   * cap can't support — this was flagged as a real gap in the prototype
   * (client-side state has no way to guarantee this).
   *
   * Pass `externalTx` when this reservation must be atomic with OTHER
   * writes outside this service's control (e.g. the multi-campaign cart
   * checkout reserving several campaigns — and creating their Orders — as
   * one all-or-nothing transaction). In that case the caller owns the
   * transaction boundary and must broadcast the result itself after ITS OWN
   * transaction commits (see CampaignsService.broadcastState).
   */
  async reserveUnits(campaignId: string, quantity: number, externalTx?: TxClient) {
    if (externalTx) {
      return this.reserveUnitsInTx(externalTx, campaignId, quantity);
    }

    const result = await this.prisma.$transaction((tx) => this.reserveUnitsInTx(tx, campaignId, quantity));

    // Broadcast only after the transaction has actually committed — doing
    // this inside the transaction callback would fire the event before the
    // write is durable, so a client could see a "live" update for a change
    // that then rolls back.
    const info = nextSlabInfo(result.updated.slabs, result.updated.bookedUnits);
    this.gateway.broadcastCampaignUpdate(campaignId, {
      bookedUnits: result.updated.bookedUnits,
      currentPrice: currentPrice(result.updated.slabs, result.updated.bookedUnits),
      unitsToNextSlab: info.unitsToNextSlab,
    });

    return { campaign: result.campaign, unitPrice: result.unitPrice };
  }

  private async reserveUnitsInTx(tx: TxClient, campaignId: string, quantity: number) {
    const campaign = await tx.campaign.findUnique({
      where: { id: campaignId },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== CampaignStatus.LIVE) {
      throw new ForbiddenException('This campaign is not currently accepting orders');
    }

    const remaining = campaign.capUnits - campaign.bookedUnits;
    if (remaining < quantity) {
      throw new ForbiddenException(`Only ${remaining} ${campaign.unitLabel} left in this campaign`);
    }

    const unitPrice = chargePriceFor(campaign.slabs, campaign.bookedUnits, quantity, campaign.capUnits);

    const updated = await tx.campaign.update({
      where: { id: campaignId },
      data: { bookedUnits: { increment: quantity } },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
    });

    return { campaign, unitPrice, updated };
  }

  /**
   * Re-reads a campaign's current state and pushes it over the socket —
   * used by callers that mutate bookedUnits themselves inside their own
   * transaction (e.g. jobs/order-expiry.service.ts releasing an expired
   * reservation alongside an order/group status update) and just need the
   * post-commit broadcast this service normally does for them.
   */
  async broadcastState(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
    });
    if (!campaign) return;
    const info = nextSlabInfo(campaign.slabs, campaign.bookedUnits);
    this.gateway.broadcastCampaignUpdate(campaignId, {
      bookedUnits: campaign.bookedUnits,
      currentPrice: currentPrice(campaign.slabs, campaign.bookedUnits),
      unitsToNextSlab: info.unitsToNextSlab,
    });
  }

  async verifyOwnership(id: string, sellerId: string) {
    await this.requireOwnedCampaign(id, sellerId);
  }

  async addMediaUrl(id: string, sellerId: string, url: string) {
    const campaign = await this.requireOwnedCampaign(id, sellerId);
    return this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { mediaUrls: { push: url } },
    });
  }

  private async requireOwnedCampaign(id: string, sellerId: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.sellerId !== sellerId) throw new ForbiddenException('Not your campaign');
    return campaign;
  }

  /** Compact shape for listing cards — mirrors gbCardHTML() in the prototype. */
  private toSummary(campaign: CampaignWithSlabs) {
    const info = nextSlabInfo(campaign.slabs, campaign.bookedUnits);
    return {
      id: campaign.id,
      productName: campaign.productName,
      farmName: campaign.farmName,
      unitLabel: campaign.unitLabel,
      status: campaign.status,
      bookedUnits: campaign.bookedUnits,
      capUnits: campaign.capUnits,
      currentPrice: currentPrice(campaign.slabs, campaign.bookedUnits),
      unitsToNextSlab: info.unitsToNextSlab,
      nextSlabPrice: info.nextSlab?.price ?? null,
      endAt: campaign.endAt,
      scopeLabel: this.scopeLabel(campaign),
    };
  }

  /** Full shape for the product/detail page. */
  private toDetail(campaign: CampaignWithSlabs) {
    const info = nextSlabInfo(campaign.slabs, campaign.bookedUnits);
    return {
      ...campaign,
      currentPrice: currentPrice(campaign.slabs, campaign.bookedUnits),
      unitsLeft: campaign.capUnits - campaign.bookedUnits,
      isLastSlab: info.isLast,
      unitsToNextSlab: info.unitsToNextSlab,
      nextSlabPrice: info.nextSlab?.price ?? null,
      scopeLabel: this.scopeLabel(campaign),
    };
  }

  /** Mirrors scopeLabel() from the prototype exactly. */
  private scopeLabel(campaign: Campaign): string {
    switch (campaign.scopeType) {
      case 'NATIONAL':
        return 'Pan India';
      case 'CITY':
        return campaign.scopeCity ?? '';
      case 'PINCODE':
        return `${campaign.scopePincode}, ${campaign.scopeCity}`;
      case 'LOCALITY':
        return `${campaign.scopeLocality}, ${campaign.scopeCity}`;
      case 'SOCIETY':
        return `${campaign.scopeSociety}, ${campaign.scopeLocality}, ${campaign.scopeCity}`;
      default:
        return '';
    }
  }
}
