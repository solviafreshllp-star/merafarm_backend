import { PrismaClient, OrderStatus } from '@prisma/client';
import { CampaignsService } from '../../src/campaigns/campaigns.service';
import { CheckoutService } from '../../src/cart/checkout.service';
import { createSeller, createBuyer, createLiveCampaign, cleanupTag, uniqueTag } from './fixtures';

/**
 * Regression test for the 2026-10-17 bug report: a buyer merely starting
 * checkout (reserving units, still PENDING_PAYMENT) was moving the
 * publicly-shown "booked units" / price-slab BEFORE payment actually
 * succeeded. The fix splits the reservation counter (campaign.bookedUnits,
 * used only to prevent overselling) from the CONFIRMED-sales count (used
 * for every price/slab number shown to buyers) — see
 * CampaignsService.confirmedUnitsFor.
 */
describe('price/slab display reflects CONFIRMED sales only, not pending reservations', () => {
  const prisma = new PrismaClient();
  const tag = uniqueTag();
  const userIds: string[] = [];
  const campaignIds: string[] = [];

  const gateway = { broadcastCampaignUpdate: jest.fn() } as any;
  const notifications = { notify: jest.fn() } as any;
  const campaigns = new CampaignsService(prisma as any, gateway, notifications);
  const razorpay = {
    createOrder: jest.fn().mockResolvedValue({ id: 'order_test_mock' }),
    verifyPaymentSignature: jest.fn().mockReturnValue(true),
  } as any;
  const checkout = new CheckoutService(prisma as any, campaigns, razorpay);

  let buyerId: string;
  let campaignId: string;

  beforeAll(async () => {
    const seller = await createSeller(prisma, tag);
    const buyer = await createBuyer(prisma, tag);
    buyerId = buyer.id;
    userIds.push(seller.id, buyer.id);

    const campaign = await createLiveCampaign(prisma, seller.id, tag, { capUnits: 100, bookedUnits: 0 });
    campaignId = campaign.id;
    campaignIds.push(campaign.id);

    await prisma.cart.create({ data: { userId: buyerId } });
  });

  afterAll(async () => {
    await cleanupTag(prisma, campaignIds, userIds);
    await prisma.$disconnect();
  });

  it('stays at the pre-checkout price/bookedUnits while a reservation is merely PENDING_PAYMENT, then moves only on confirm', async () => {
    const before = await campaigns.findOne(campaignId);
    expect(before.bookedUnits).toBe(0);
    expect(before.currentPrice).toBe(1000); // slab[0]

    const cart = await prisma.cart.findUniqueOrThrow({ where: { userId: buyerId } });
    await prisma.cartItem.create({ data: { cartId: cart.id, campaignId, quantity: 12 } });

    await checkout.checkout(buyerId, { address: { flat: 'A-9' } });

    // Public view: unchanged — nothing has been PAID for yet.
    const afterReserve = await campaigns.findOne(campaignId);
    expect(afterReserve.bookedUnits).toBe(0);
    expect(afterReserve.currentPrice).toBe(1000);

    // Internal capacity WAS consumed, proven directly against the raw column.
    const raw = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(raw.bookedUnits).toBe(12);

    // Now actually confirm the payment.
    const pendingOrder = await prisma.order.findFirstOrThrow({
      where: { campaignId, status: OrderStatus.PENDING_PAYMENT },
    });
    await prisma.order.update({
      where: { id: pendingOrder.id },
      data: { status: OrderStatus.CONFIRMED, paymentRef: 'pay_test_mock' },
    });
    await campaigns.broadcastState(campaignId);

    // Only NOW does the public view move — crossed the 10-unit slab -> ₹800.
    const afterConfirm = await campaigns.findOne(campaignId);
    expect(afterConfirm.bookedUnits).toBe(12);
    expect(afterConfirm.currentPrice).toBe(800);
  });
});
