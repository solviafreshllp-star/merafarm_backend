import { PrismaClient, OrderStatus } from '@prisma/client';
import { OrderExpiryService } from '../../src/jobs/order-expiry.service';
import { CampaignsService } from '../../src/campaigns/campaigns.service';
import { createSeller, createBuyer, createLiveCampaign, cleanupTag, uniqueTag } from './fixtures';

describe('OrderExpiryService.expireStalePendingOrders', () => {
  const prisma = new PrismaClient();
  const tag = uniqueTag();
  const userIds: string[] = [];
  const campaignIds: string[] = [];

  const gateway = { broadcastCampaignUpdate: jest.fn() } as any;
  const notifications = { notify: jest.fn() } as any;
  const campaigns = new CampaignsService(prisma as any, gateway, notifications);
  const expiry = new OrderExpiryService(prisma as any, campaigns);

  let campaignId: string;
  let buyerId: string;

  beforeAll(async () => {
    const seller = await createSeller(prisma, tag);
    const buyer = await createBuyer(prisma, tag);
    userIds.push(seller.id, buyer.id);
    buyerId = buyer.id;

    const campaign = await createLiveCampaign(prisma, seller.id, tag, { bookedUnits: 8, capUnits: 100 });
    campaignId = campaign.id;
    campaignIds.push(campaign.id);
  });

  afterAll(async () => {
    await cleanupTag(prisma, campaignIds, userIds);
    await prisma.$disconnect();
  });

  it('cancels a stale standalone order and releases its units, leaves a fresh one alone', async () => {
    const staleCreatedAt = new Date(Date.now() - 20 * 60_000); // 20 min ago, past the 15-min default window
    const stale = await prisma.order.create({
      data: {
        orderNumber: `ORDEXP${tag}1`,
        userId: buyerId,
        campaignId,
        quantity: 3,
        unitPriceCharged: 1000,
        amount: 3000,
        status: OrderStatus.PENDING_PAYMENT,
        addressCity: 'TestCity',
        addressPincode: '100000',
        addressLocality: 'TestLocality',
        addressSociety: 'TestSociety',
        addressFlat: 'A-1',
        createdAt: staleCreatedAt,
      },
    });
    const fresh = await prisma.order.create({
      data: {
        orderNumber: `ORDEXP${tag}2`,
        userId: buyerId,
        campaignId,
        quantity: 2,
        unitPriceCharged: 1000,
        amount: 2000,
        status: OrderStatus.PENDING_PAYMENT,
        addressCity: 'TestCity',
        addressPincode: '100000',
        addressLocality: 'TestLocality',
        addressSociety: 'TestSociety',
        addressFlat: 'A-2',
      },
    });

    await expiry.expireStalePendingOrders();

    const [staleAfter, freshAfter, campaignAfter] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: stale.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: fresh.id } }),
      prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    ]);

    expect(staleAfter.status).toBe('CANCELLED');
    expect(freshAfter.status).toBe('PENDING_PAYMENT');
    // 8 initial - 3 released from the stale order = 5 (the fresh order's units were never "released" since reserveUnits was never called for it in this test).
    expect(campaignAfter.bookedUnits).toBe(5);
  });

  it('expires every order under a stale OrderGroup together, not just one', async () => {
    const group = await prisma.orderGroup.create({
      data: {
        userId: buyerId,
        status: OrderStatus.PENDING_PAYMENT,
        createdAt: new Date(Date.now() - 20 * 60_000),
      },
    });
    const [orderA, orderB] = await Promise.all([
      prisma.order.create({
        data: {
          orderNumber: `ORDEXP${tag}3`,
          userId: buyerId,
          campaignId,
          quantity: 1,
          unitPriceCharged: 1000,
          amount: 1000,
          status: OrderStatus.PENDING_PAYMENT,
          addressCity: 'TestCity',
          addressPincode: '100000',
          addressLocality: 'TestLocality',
          addressSociety: 'TestSociety',
          addressFlat: 'A-3',
          orderGroupId: group.id,
        },
      }),
      prisma.order.create({
        data: {
          orderNumber: `ORDEXP${tag}4`,
          userId: buyerId,
          campaignId,
          quantity: 1,
          unitPriceCharged: 1000,
          amount: 1000,
          status: OrderStatus.PENDING_PAYMENT,
          addressCity: 'TestCity',
          addressPincode: '100000',
          addressLocality: 'TestLocality',
          addressSociety: 'TestSociety',
          addressFlat: 'A-4',
          orderGroupId: group.id,
        },
      }),
    ]);

    await expiry.expireStalePendingOrders();

    const [groupAfter, orderAAfter, orderBAfter] = await Promise.all([
      prisma.orderGroup.findUniqueOrThrow({ where: { id: group.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: orderA.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: orderB.id } }),
    ]);

    expect(groupAfter.status).toBe('CANCELLED');
    expect(orderAAfter.status).toBe('CANCELLED');
    expect(orderBAfter.status).toBe('CANCELLED');
  });
});
