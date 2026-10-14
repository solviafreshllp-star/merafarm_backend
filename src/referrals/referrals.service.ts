import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const TIERS = [
  { name: 'New Member', threshold: 0 },
  { name: 'Bronze Organizer', threshold: 50 },
  { name: 'Silver Organizer', threshold: 150 },
  { name: 'Gold Organizer', threshold: 350 },
] as const;

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get-or-create: generating a link does NOT by itself log an INVITED
   * event (see TASKS.md 1.5) — the frontend pings sharePing() on every
   * actual share tap instead, which is closer to the prototype's "every
   * share bumps invited" behavior than crediting a single INVITED the
   * moment a link merely exists.
   */
  async getOrCreate(userId: string, campaignId: string) {
    const existing = await this.prisma.referralLink.findUnique({
      where: { userId_campaignId: { userId, campaignId } },
    });
    if (existing) return this.toResponse(existing.code);

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = this.generateCode();
      try {
        const link = await this.prisma.referralLink.create({
          data: { userId, campaignId, code },
        });
        return this.toResponse(link.code);
      } catch (err: any) {
        if (err?.code === 'P2002') continue; // unique code collision — retry
        throw err;
      }
    }
    throw new Error('Could not generate a unique referral code after 5 attempts');
  }

  async findMine(userId: string, campaignId: string) {
    const link = await this.prisma.referralLink.findUnique({
      where: { userId_campaignId: { userId, campaignId } },
    });
    if (!link) throw new NotFoundException('No referral link yet for this campaign');
    return this.toResponse(link.code);
  }

  async sharePing(userId: string, code: string) {
    const link = await this.prisma.referralLink.findUnique({ where: { code } });
    if (!link) throw new NotFoundException('Referral link not found');
    if (link.userId !== userId) throw new ForbiddenException('Not your referral link');

    await this.prisma.referralEvent.create({
      data: { referralLinkId: link.id, type: 'INVITED' },
    });
    return { ok: true };
  }

  async stats(userId: string) {
    const links = await this.prisma.referralLink.findMany({
      where: { userId },
      include: { events: true },
    });

    const events = links.flatMap((l) => l.events);
    const invited = events.filter((e) => e.type === 'INVITED').length;
    const joined = events.filter((e) => e.type === 'JOINED').length;
    const unitsAdded = events
      .filter((e) => e.type === 'ORDER_PLACED')
      .reduce((sum, e) => sum + (e.unitsAdded ?? 0), 0);

    const points = invited * 5 + joined * 25 + unitsAdded * 10;

    let currentTier: (typeof TIERS)[number] = TIERS[0];
    for (const tier of TIERS) {
      if (points >= tier.threshold) currentTier = tier;
    }
    const next = TIERS.find((t) => t.threshold > currentTier.threshold) ?? null;

    return {
      points,
      invited,
      joined,
      unitsAdded,
      tier: currentTier.name,
      nextTier: next?.name ?? null,
      pointsToNextTier: next ? next.threshold - points : null,
    };
  }

  private toResponse(code: string) {
    const base = process.env.CORS_ORIGIN?.split(',')[0] ?? 'http://localhost:3000';
    return { code, shareUrl: `${base}/r/${code}` };
  }

  private generateCode(): string {
    return randomBytes(6).toString('base64url');
  }
}
