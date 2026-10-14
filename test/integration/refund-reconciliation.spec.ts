import { PrismaClient, OrderStatus } from '@prisma/client';
import { OrdersService } from '../../src/orders/orders.service';
import { CampaignsService } from '../../src/campaigns/campaigns.service';
import { createSeller, createBuyer, createLiveCampaign, cleanupTag, uniqueTag } from './fixtures';

/**
 * Integration test for OrdersService.reconcileRefundsForCampaign — the
 * "a later buyer unlocked a lower price, top up everyone who paid more"
 * logic. Exercises real Prisma writes/reads against the configured
 * DATABASE_URL; Razorpay and the BullMQ refunds queue are mocked since this
 * only needs to verify a Refund ROW gets created with the right amount, not
 * that Razorpay/BullMQ themselves work (see TASKS.md 1.18).
 */
describe('OrdersService.reconcileRefundsForCampaign', () => {
  const prisma = new PrismaClient();
  const tag = uniqueTag();
  let sellerId: string;
  let buyerId: string;
  let campaignId: string;
  const userIds: string[] = [];
  const campaignIds: string[] = [];

  const gateway = { broadcastCampaignUpdate: jest.fn() } as any;
  const notifications = { notify: jest.fn() } as any;
  const campaigns = new CampaignsService(prisma as any, gateway, notifications);
  const razorpay = {} as any;
  const refundsQueue = { add: jest.fn() } as any;
  const orders = new OrdersService(prisma as any, campaigns, razorpay, refundsQueue);

  beforeAll(async () => {
    const seller = await createSeller(prisma, tag);
    const buyer = await createBuyer(prisma, tag);
    sellerId = seller.id;
    buyerId = buyer.id;
    userIds.push(seller.id, buyer.id);

    const campaign = await createLiveCampaign(prisma, sellerId, tag, { bookedUnits: 15, capUnits: 100 });
    campaignId = campaign.id;
    campaignIds.push(campaign.id);
  });

  afterAll(async () => {
    await cleanupTag(prisma, campaignIds, userIds);
    await prisma.$disconnect();
  });

  it('tops up a refund for an order that paid more than the current unlocked price', async () => {
    // This order was charged the ₹1000 tier (booked was below 10 when it was placed).
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORDTEST${tag}1`,
        userId: buyerId,
        campaignId,
        quantity: 5,
        unitPriceCharged: 1000,
        amount: 5000,
        status: OrderStatus.CONFIRMED,
        addressCity: 'TestCity',
        addressPincode: '100000',
        addressLocality: 'TestLocality',
        addressSociety: 'TestSociety',
        addressFlat: 'A-1',
      },
    });

    // Campaign is now at 15 booked units -> current price is ₹800 (crossed
    // the 10-unit slab after this order was placed) — reconciliation should
    // refund (1000 - 800) * 5 = 1000.
    await orders.reconcileRefundsForCampaign(campaignId);

    const refunds = await prisma.refund.findMany({ where: { orderId: order.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBe(1000);
    expect(refunds[0].status).toBe('PENDING');
    expect(refundsQueue.add).toHaveBeenCalledWith('process-refund', { refundId: refunds[0].id });
  });

  it('is idempotent — a second call does not double-refund the same gap', async () => {
    refundsQueue.add.mockClear();
    await orders.reconcileRefundsForCampaign(campaignId);

    const refunds = await prisma.refund.findMany({ where: { order: { campaignId } } });
    // Still just the one refund from the first call — nothing additional owed.
    const totalRefunded = refunds.reduce((sum, r) => sum + r.amount, 0);
    expect(totalRefunded).toBe(1000);
    expect(refundsQueue.add).not.toHaveBeenCalled();
  });
});
