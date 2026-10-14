import { PrismaClient, ScopeType, CampaignStatus } from '@prisma/client';

/**
 * These integration tests run against the real DATABASE_URL (there's no
 * separate test database configured for this project) — every fixture ID
 * is prefixed with a per-run random tag and torn down in afterAll, so runs
 * never collide with each other or with the seeded demo data.
 */
export function uniqueTag(): string {
  return Math.random().toString(36).slice(2, 10);
}

export async function createSeller(prisma: PrismaClient, tag: string) {
  return prisma.user.create({
    data: { name: `Test Seller ${tag}`, phone: `9${tag.padEnd(9, '1').slice(0, 9)}`, isSeller: true },
  });
}

export async function createBuyer(prisma: PrismaClient, tag: string, suffix = 'b') {
  return prisma.user.create({
    data: { name: `Test Buyer ${tag}${suffix}`, phone: `8${tag.padEnd(8, '1').slice(0, 8)}${suffix}` },
  });
}

export async function createLiveCampaign(
  prisma: PrismaClient,
  sellerId: string,
  tag: string,
  opts: Partial<{ capUnits: number; bookedUnits: number; scopeType: ScopeType; status: CampaignStatus }> = {},
) {
  return prisma.campaign.create({
    data: {
      productName: `Test Product ${tag}`,
      farmName: 'Test Farm',
      sellerId,
      scopeType: opts.scopeType ?? ScopeType.SOCIETY,
      scopeCity: 'TestCity',
      scopePincode: '100000',
      scopeLocality: 'TestLocality',
      scopeSociety: 'TestSociety',
      capUnits: opts.capUnits ?? 100,
      bookedUnits: opts.bookedUnits ?? 0,
      status: opts.status ?? CampaignStatus.LIVE,
      startAt: new Date(Date.now() - 60_000),
      endAt: new Date(Date.now() + 86_400_000),
      slabs: {
        create: [
          { fromQty: 1, price: 1000 },
          { fromQty: 10, price: 800 },
          { fromQty: 20, price: 600 },
        ],
      },
    },
    include: { slabs: true },
  });
}

/** Deletes everything under a tag's campaigns/users — call in afterAll. */
export async function cleanupTag(prisma: PrismaClient, campaignIds: string[], userIds: string[]) {
  const orders = await prisma.order.findMany({ where: { campaignId: { in: campaignIds } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
  const groupIds = (
    await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { orderGroupId: true } })
  )
    .map((o) => o.orderGroupId)
    .filter((id): id is string => !!id);
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.orderGroup.deleteMany({ where: { id: { in: [...new Set(groupIds)] } } });
  await prisma.cartItem.deleteMany({ where: { campaignId: { in: campaignIds } } });
  await prisma.priceSlab.deleteMany({ where: { campaignId: { in: campaignIds } } });
  await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
  await prisma.cart.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
