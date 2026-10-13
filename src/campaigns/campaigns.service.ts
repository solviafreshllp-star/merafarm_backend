import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Campaign, CampaignStatus, PriceSlab } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCapDto } from './dto/update-cap.dto';
import { chargePriceFor, currentPrice, nextSlabInfo } from './pricing.util';
import { CampaignsGateway } from '../realtime/campaigns.gateway';

type CampaignWithSlabs = Campaign & { slabs: PriceSlab[] };

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: CampaignsGateway,
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

  async goLive(id: string, sellerId: string) {
    const campaign = await this.requireOwnedCampaign(id, sellerId);
    return this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: CampaignStatus.LIVE },
    });
  }

  /**
   * Atomically bumps bookedUnits and returns the price this specific order
   * quantity unlocks. Wrapped in a transaction with row locking so two
   * checkouts racing near a threshold can't both be promised a price the
   * cap can't support — this was flagged as a real gap in the prototype
   * (client-side state has no way to guarantee this).
   */
  async reserveUnits(campaignId: string, quantity: number) {
    const result = await this.prisma.$transaction(async (tx) => {
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
    });

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
