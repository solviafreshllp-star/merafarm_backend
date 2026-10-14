import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CampaignStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { currentPrice } from '../campaigns/pricing.util';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  private async getOrCreateCart(userId: string) {
    const existing = await this.prisma.cart.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.cart.create({ data: { userId } });
  }

  async getCart(userId: string) {
    const cart = await this.getOrCreateCart(userId);
    const items = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      include: { campaign: { include: { slabs: { orderBy: { fromQty: 'asc' } } } } },
      orderBy: { createdAt: 'asc' },
    });

    const lines = items.map((item) => {
      const unitPrice = currentPrice(item.campaign.slabs, item.campaign.bookedUnits);
      return {
        campaignId: item.campaignId,
        productName: item.campaign.productName,
        farmName: item.campaign.farmName,
        unitLabel: item.campaign.unitLabel,
        quantity: item.quantity,
        unitPrice,
        lineTotal: unitPrice * item.quantity,
        campaignStatus: item.campaign.status,
        unitsLeft: item.campaign.capUnits - item.campaign.bookedUnits,
      };
    });

    return { items: lines, total: lines.reduce((sum, l) => sum + l.lineTotal, 0) };
  }

  async addItem(userId: string, campaignId: string, quantity: number) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== CampaignStatus.LIVE) {
      throw new ForbiddenException('This campaign is not currently accepting orders');
    }

    const cart = await this.getOrCreateCart(userId);
    await this.prisma.cartItem.upsert({
      where: { cartId_campaignId: { cartId: cart.id, campaignId } },
      update: { quantity },
      create: { cartId: cart.id, campaignId, quantity },
    });
    return this.getCart(userId);
  }

  async updateItem(userId: string, campaignId: string, quantity: number) {
    const cart = await this.getOrCreateCart(userId);
    const item = await this.prisma.cartItem.findUnique({
      where: { cartId_campaignId: { cartId: cart.id, campaignId } },
    });
    if (!item) throw new NotFoundException('That campaign is not in your cart');
    await this.prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
    return this.getCart(userId);
  }

  async removeItem(userId: string, campaignId: string) {
    const cart = await this.getOrCreateCart(userId);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id, campaignId } });
    return this.getCart(userId);
  }
}
