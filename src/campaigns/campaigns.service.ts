import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Campaign, CampaignStatus, OrderStatus, Prisma, PriceSlab } from '@prisma/client';
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
        deliveryStartAt: new Date(dto.deliveryStartAt),
        deliveryEndAt: new Date(dto.deliveryEndAt),
        status: CampaignStatus.DRAFT,
        slabs: { create: sortedSlabs },
      },
      include: { slabs: true },
    });
  }

  /**
   * The public listing — only campaigns actually open for ordering RIGHT
   * NOW: `status = LIVE` is necessary but not sufficient, since a campaign
   * keeps that status after its own `endAt` passes (nothing flips it back)
   * and before its `startAt` arrives. Buyers should never see an expired
   * or not-yet-open campaign in Home/Campaigns — that's what this extra
   * time-window filter is for.
   */
  async findLive(params: { city?: string; category?: string } = {}) {
    const now = new Date();
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: CampaignStatus.LIVE,
        startAt: { lte: now },
        endAt: { gt: now },
        ...(params.city ? { scopeCity: params.city } : {}),
      },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    const confirmed = await this.confirmedUnitsForMany(campaigns.map((c) => c.id));
    return campaigns.map((c) => this.toSummary(c, confirmed[c.id] ?? 0));
  }

  async findOne(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    const confirmedUnits = await this.confirmedUnitsFor(id);
    return this.toDetail(campaign, confirmedUnits);
  }

  /** Editable any time — including after the campaign has gone live. */
  async updateCap(id: string, sellerId: string, dto: UpdateCapDto) {
    const campaign = await this.requireOwnedCampaign(id, sellerId);
    const updated = await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { capUnits: dto.capUnits },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
    });
    const confirmedUnits = await this.confirmedUnitsFor(id);
    return this.toDetail(updated, confirmedUnits);
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
    const updated = await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: CampaignStatus.PENDING_REVIEW, rejectionReason: null },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
    });
    const confirmedUnits = await this.confirmedUnitsFor(id);
    return this.toDetail(updated, confirmedUnits);
  }

  /** Seller's own campaigns across every status — the seller dashboard list. */
  async findMine(sellerId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { sellerId },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    const confirmed = await this.confirmedUnitsForMany(campaigns.map((c) => c.id));
    return campaigns.map((c) => this.toDetail(c, confirmed[c.id] ?? 0));
  }

  /**
   * Admin-facing listing across EVERY seller, optionally filtered by
   * status — the campaign approval queue (`status=PENDING_REVIEW`) and the
   * campaign management screen (no filter) both key off this. Includes the
   * seller's own contact details since an admin reviewing/overriding a
   * campaign usually needs to know whose it is.
   */
  async adminList(params: { status?: CampaignStatus } = {}) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { ...(params.status ? { status: params.status } : {}) },
      include: {
        slabs: { orderBy: { fromQty: 'asc' } },
        seller: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const confirmed = await this.confirmedUnitsForMany(campaigns.map((c) => c.id));
    return campaigns.map((c) => this.toDetail(c, confirmed[c.id] ?? 0));
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
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.LIVE },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
    });
    const confirmedUnits = await this.confirmedUnitsFor(id);
    return this.toDetail(updated, confirmedUnits);
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
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
    });
    await this.notifications.notify(
      campaign.sellerId,
      'CAMPAIGN_REJECTED',
      'Your campaign needs changes',
      `"${campaign.productName}" was sent back to drafts: ${reason}`,
    );
    const confirmedUnits = await this.confirmedUnitsFor(id);
    return this.toDetail(updated, confirmedUnits);
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

    const updated = await this.prisma.campaign.update({
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
        ...(dto.deliveryStartAt !== undefined && { deliveryStartAt: new Date(dto.deliveryStartAt) }),
        ...(dto.deliveryEndAt !== undefined && { deliveryEndAt: new Date(dto.deliveryEndAt) }),
        ...(dto.slabs !== undefined && {
          slabs: {
            deleteMany: {},
            create: [...dto.slabs].sort((a, b) => a.fromQty - b.fromQty),
          },
        }),
      },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
    });
    const confirmedUnits = await this.confirmedUnitsFor(id);
    return this.toDetail(updated, confirmedUnits);
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
    // that then rolls back. A mere reservation never moves the
    // confirmed-based price shown to buyers (see broadcastState) — the only
    // thing that genuinely changes here is remaining capacity.
    this.gateway.broadcastCampaignUpdate(campaignId, {
      unitsLeft: result.updated.capUnits - result.updated.bookedUnits,
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
    const now = new Date();
    if (now < campaign.startAt || now >= campaign.endAt) {
      // Mirrors findLive()'s listing filter — `status = LIVE` alone doesn't
      // mean "open right now," since nothing flips the status back once
      // endAt passes. Without this, a buyer with a stale/bookmarked link to
      // a campaign that's no longer publicly listed could still check out.
      throw new ForbiddenException('This campaign’s preorder window is not currently open');
    }

    // Capacity check stays reserved-based (campaign.bookedUnits, bumped
    // immediately below) — this is what actually prevents overselling.
    // Keeping it separate from the CONFIRMED-only count used for pricing
    // (confirmedUnitsFor) is the whole point of this split: a buyer who
    // merely starts checkout and abandons it must not be able to oversell
    // the cap, but also must not move the price everyone else sees until
    // they actually pay — see TASKS.md / the 2026-10-17 fix note.
    const remaining = campaign.capUnits - campaign.bookedUnits;
    if (remaining < quantity) {
      throw new ForbiddenException(`Only ${remaining} ${campaign.unitLabel} left in this campaign`);
    }

    const confirmedBefore = await this.confirmedUnitsFor(campaignId, tx);
    const unitPrice = chargePriceFor(campaign.slabs, confirmedBefore, quantity, campaign.capUnits);

    const updated = await tx.campaign.update({
      where: { id: campaignId },
      data: { bookedUnits: { increment: quantity } },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
    });

    return { campaign, unitPrice, updated };
  }

  /**
   * Re-reads a campaign's CONFIRMED-sales state and pushes it over the
   * socket — this is the thing that should fire right after an order is
   * actually paid for (see OrdersService.reconcileRefundsForCampaign, which
   * calls this), not when someone merely starts checkout. Also used by
   * jobs/order-expiry.service.ts after releasing an expired reservation.
   */
  async broadcastState(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
    });
    if (!campaign) return;
    const confirmedUnits = await this.confirmedUnitsFor(campaignId);
    const info = nextSlabInfo(campaign.slabs, confirmedUnits);
    this.gateway.broadcastCampaignUpdate(campaignId, {
      bookedUnits: confirmedUnits,
      currentPrice: currentPrice(campaign.slabs, confirmedUnits),
      unitsToNextSlab: info.unitsToNextSlab,
      nextSlabPrice: info.nextSlab?.price ?? null,
      unitsLeft: campaign.capUnits - campaign.bookedUnits,
    });
  }

  async verifyOwnership(id: string, sellerId: string) {
    await this.requireOwnedCampaign(id, sellerId);
  }

  async addMediaUrl(id: string, sellerId: string, url: string) {
    const campaign = await this.requireOwnedCampaign(id, sellerId);
    const updated = await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { mediaUrls: { push: url } },
      include: { slabs: { orderBy: { fromQty: 'asc' } } },
    });
    const confirmedUnits = await this.confirmedUnitsFor(id);
    return this.toDetail(updated, confirmedUnits);
  }

  private async requireOwnedCampaign(id: string, sellerId: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.sellerId !== sellerId) throw new ForbiddenException('Not your campaign');
    return campaign;
  }

  /**
   * Sum of `quantity` across every CONFIRMED (actually paid) order on a
   * campaign — the basis for every price/slab number shown to buyers and
   * for what a NEW order gets quoted (see reserveUnitsInTx above). Deliberately
   * NOT the same as campaign.bookedUnits, which also includes units merely
   * reserved by an in-flight, unpaid checkout (see TASKS.md 2026-10-17 note:
   * a buyer abandoning checkout was inflating the publicly-shown "booked"
   * count and price before this split existed).
   */
  async confirmedUnitsFor(campaignId: string, client: PrismaService | TxClient = this.prisma): Promise<number> {
    const agg = await client.order.aggregate({
      where: { campaignId, status: OrderStatus.CONFIRMED },
      _sum: { quantity: true },
    });
    return agg._sum.quantity ?? 0;
  }

  private async confirmedUnitsForMany(campaignIds: string[]): Promise<Record<string, number>> {
    if (campaignIds.length === 0) return {};
    const groups = await this.prisma.order.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaignIds }, status: OrderStatus.CONFIRMED },
      _sum: { quantity: true },
    });
    const map: Record<string, number> = {};
    for (const g of groups) map[g.campaignId] = g._sum.quantity ?? 0;
    return map;
  }

  /** Compact shape for listing cards — mirrors gbCardHTML() in the prototype. */
  private toSummary(campaign: CampaignWithSlabs, confirmedUnits: number) {
    const info = nextSlabInfo(campaign.slabs, confirmedUnits);
    return {
      id: campaign.id,
      productName: campaign.productName,
      farmName: campaign.farmName,
      unitLabel: campaign.unitLabel,
      status: campaign.status,
      // Confirmed (paid) units, not the raw reservation counter — see
      // confirmedUnitsFor's doc comment.
      bookedUnits: confirmedUnits,
      capUnits: campaign.capUnits,
      currentPrice: currentPrice(campaign.slabs, confirmedUnits),
      unitsToNextSlab: info.unitsToNextSlab,
      nextSlabPrice: info.nextSlab?.price ?? null,
      // Preorder window — so the listing card can run the same live
      // countdown the detail page does, not just show a bare end date.
      startAt: campaign.startAt,
      endAt: campaign.endAt,
      // Delivery window — a separate date range from the preorder window
      // above (see the Campaign model's doc comment): when the produce
      // actually reaches buyers. Null for campaigns created before this
      // field existed.
      deliveryStartAt: campaign.deliveryStartAt,
      deliveryEndAt: campaign.deliveryEndAt,
      scopeLabel: this.scopeLabel(campaign),
      mediaUrls: campaign.mediaUrls,
      // Exposed so cards can compute a live preview of what the viewer's
      // OWN pending cart quantity would unlock, the same way the detail
      // page and checkout already do — see pricingPreview.ts on the
      // frontend. Already loaded for this request either way (used just
      // above for currentPrice/nextSlabPrice), so this is free.
      slabs: campaign.slabs,
      // Reservation-based (raw campaign.bookedUnits, NOT confirmedUnits) —
      // "can a buyer still add this to their cart right now," same
      // distinction toDetail() makes. A card using confirmedUnits here
      // would stay "available" even after every unit was already reserved
      // by other in-flight checkouts.
      unitsLeft: campaign.capUnits - campaign.bookedUnits,
    };
  }

  /** Full shape for the product/detail page. */
  private toDetail(campaign: CampaignWithSlabs, confirmedUnits: number) {
    const info = nextSlabInfo(campaign.slabs, confirmedUnits);
    return {
      ...campaign,
      // Confirmed (paid) units override the raw DB field — see
      // confirmedUnitsFor's doc comment. unitsLeft stays reserved-based
      // (campaign.bookedUnits, from the spread above) since that's a
      // genuinely different question: "how much is still available to
      // reserve right now" vs. "how much has actually sold."
      bookedUnits: confirmedUnits,
      currentPrice: currentPrice(campaign.slabs, confirmedUnits),
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
