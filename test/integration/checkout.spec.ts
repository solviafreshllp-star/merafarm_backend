import { PrismaClient } from '@prisma/client';
import { CampaignsService } from '../../src/campaigns/campaigns.service';
import { OrdersService } from '../../src/orders/orders.service';
import { CheckoutService } from '../../src/cart/checkout.service';
import { createSeller, createBuyer, createLiveCampaign, cleanupTag, uniqueTag } from './fixtures';

/**
 * The core guarantee under test: a cart checkout spanning multiple
 * campaigns reserves units for ALL of them in one transaction — if any one
 * campaign is sold out, NOTHING partially reserves (see TASKS.md 1.6).
 */
describe('CheckoutService.checkout — atomic multi-campaign reservation', () => {
  const prisma = new PrismaClient();
  const tag = uniqueTag();
  const userIds: string[] = [];
  const campaignIds: string[] = [];

  const gateway = { broadcastCampaignUpdate: jest.fn() } as any;
  const notifications = { notify: jest.fn() } as any;
  const campaigns = new CampaignsService(prisma as any, gateway, notifications);
  const razorpayQueueless = { add: jest.fn() } as any;
  const razorpay = {
    createOrder: jest.fn().mockResolvedValue({ id: 'order_test_mock' }),
    verifyPaymentSignature: jest.fn().mockReturnValue(true),
  } as any;
  const orders = new OrdersService(prisma as any, campaigns, razorpay, razorpayQueueless);
  const checkout = new CheckoutService(prisma as any, campaigns, orders, razorpay);

  let buyerId: string;
  let roomyCampaignId: string;
  let almostSoldOutCampaignId: string;

  beforeAll(async () => {
    const seller = await createSeller(prisma, tag);
    const buyer = await createBuyer(prisma, tag);
    buyerId = buyer.id;
    userIds.push(seller.id, buyer.id);

    const roomy = await createLiveCampaign(prisma, seller.id, tag + 'a', { capUnits: 100, bookedUnits: 0 });
    const almostSoldOut = await createLiveCampaign(prisma, seller.id, tag + 'b', { capUnits: 10, bookedUnits: 9 });
    roomyCampaignId = roomy.id;
    almostSoldOutCampaignId = almostSoldOut.id;
    campaignIds.push(roomy.id, almostSoldOut.id);

    await prisma.cart.create({ data: { userId: buyerId } });
  });

  afterAll(async () => {
    await cleanupTag(prisma, campaignIds, userIds);
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.cartItem.deleteMany({ where: { cart: { userId: buyerId } } });
  });

  it('rolls back every reservation in the cart if one campaign cannot fulfill its item', async () => {
    const cart = await prisma.cart.findUniqueOrThrow({ where: { userId: buyerId } });
    await prisma.cartItem.createMany({
      data: [
        { cartId: cart.id, campaignId: roomyCampaignId, quantity: 5 },
        { cartId: cart.id, campaignId: almostSoldOutCampaignId, quantity: 5 }, // only 1 unit left — must fail
      ],
    });

    await expect(
      checkout.checkout(buyerId, { address: { flat: 'A-1' } }),
    ).rejects.toThrow(/left in this campaign/);

    const [roomyAfter, soldOutAfter] = await Promise.all([
      prisma.campaign.findUniqueOrThrow({ where: { id: roomyCampaignId } }),
      prisma.campaign.findUniqueOrThrow({ where: { id: almostSoldOutCampaignId } }),
    ]);
    // Neither campaign's bookedUnits moved — the roomy campaign's successful
    // reservation must have rolled back along with the failed one.
    expect(roomyAfter.bookedUnits).toBe(0);
    expect(soldOutAfter.bookedUnits).toBe(9);

    const orderCount = await prisma.order.count({ where: { campaignId: { in: [roomyCampaignId, almostSoldOutCampaignId] } } });
    expect(orderCount).toBe(0);
  });

  it('reserves units across every campaign in the cart when all can fulfill their item', async () => {
    const cart = await prisma.cart.findUniqueOrThrow({ where: { userId: buyerId } });
    await prisma.cartItem.createMany({
      data: [
        { cartId: cart.id, campaignId: roomyCampaignId, quantity: 5 },
        { cartId: cart.id, campaignId: almostSoldOutCampaignId, quantity: 1 }, // exactly the last unit
      ],
    });

    const result = await checkout.checkout(buyerId, { address: { flat: 'A-1' } });
    expect(result.razorpayOrderId).toBe('order_test_mock');

    const [roomyAfter, soldOutAfter, remainingCartItems] = await Promise.all([
      prisma.campaign.findUniqueOrThrow({ where: { id: roomyCampaignId } }),
      prisma.campaign.findUniqueOrThrow({ where: { id: almostSoldOutCampaignId } }),
      prisma.cartItem.findMany({ where: { cartId: cart.id } }),
    ]);
    expect(roomyAfter.bookedUnits).toBe(5);
    expect(soldOutAfter.bookedUnits).toBe(10);
    expect(remainingCartItems).toHaveLength(0); // cart cleared after checkout

    const createdOrders = await prisma.order.findMany({ where: { orderGroupId: { not: null }, userId: buyerId } });
    expect(createdOrders).toHaveLength(2);
    expect(createdOrders.every((o) => o.status === 'PENDING_PAYMENT')).toBe(true);
  });
});
