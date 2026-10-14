import { PrismaClient, CampaignStatus } from '@prisma/client';
import { CampaignsService } from '../../src/campaigns/campaigns.service';
import { createSeller, cleanupTag, uniqueTag } from './fixtures';

describe('CampaignsService approval state machine', () => {
  const prisma = new PrismaClient();
  const tag = uniqueTag();
  const userIds: string[] = [];
  const campaignIds: string[] = [];

  const gateway = { broadcastCampaignUpdate: jest.fn() } as any;
  const notifications = { notify: jest.fn() } as any;
  const campaigns = new CampaignsService(prisma as any, gateway, notifications);

  let sellerId: string;

  beforeAll(async () => {
    const seller = await createSeller(prisma, tag);
    sellerId = seller.id;
    userIds.push(seller.id);
  });

  afterAll(async () => {
    await cleanupTag(prisma, campaignIds, userIds);
    await prisma.$disconnect();
  });

  async function createDraft() {
    const campaign = await prisma.campaign.create({
      data: {
        productName: `Approval Test ${tag}`,
        farmName: 'Test Farm',
        sellerId,
        scopeType: 'CITY',
        scopeCity: 'TestCity',
        capUnits: 10,
        status: CampaignStatus.DRAFT,
        startAt: new Date(),
        endAt: new Date(Date.now() + 86_400_000),
        slabs: { create: [{ fromQty: 1, price: 100 }] },
      },
    });
    campaignIds.push(campaign.id);
    return campaign;
  }

  it('goLive moves DRAFT -> PENDING_REVIEW, not straight to LIVE', async () => {
    const draft = await createDraft();
    const result = await campaigns.goLive(draft.id, sellerId);
    expect(result.status).toBe('PENDING_REVIEW');
  });

  it('goLive refuses anything that is not currently DRAFT', async () => {
    const draft = await createDraft();
    await campaigns.goLive(draft.id, sellerId); // -> PENDING_REVIEW
    await expect(campaigns.goLive(draft.id, sellerId)).rejects.toThrow(
      'Only a draft campaign can be submitted for review',
    );
  });

  it('approve moves PENDING_REVIEW -> LIVE', async () => {
    const draft = await createDraft();
    await campaigns.goLive(draft.id, sellerId);
    const approved = await campaigns.approve(draft.id);
    expect(approved.status).toBe('LIVE');
  });

  it('approve refuses a campaign that is not PENDING_REVIEW', async () => {
    const draft = await createDraft();
    await expect(campaigns.approve(draft.id)).rejects.toThrow('Only a campaign pending review can be approved');
  });

  it('reject sends PENDING_REVIEW back to DRAFT with a reason, and notifies the seller', async () => {
    const draft = await createDraft();
    await campaigns.goLive(draft.id, sellerId);
    notifications.notify.mockClear();

    const rejected = await campaigns.reject(draft.id, 'Needs better photos');
    expect(rejected.status).toBe('DRAFT');
    expect(rejected.rejectionReason).toBe('Needs better photos');
    expect(notifications.notify).toHaveBeenCalledWith(
      sellerId,
      'CAMPAIGN_REJECTED',
      expect.any(String),
      expect.stringContaining('Needs better photos'),
    );
  });

  it('a rejected-then-resubmitted campaign can go live again and clears the old rejection reason', async () => {
    const draft = await createDraft();
    await campaigns.goLive(draft.id, sellerId);
    await campaigns.reject(draft.id, 'Fix pricing');

    const resubmitted = await campaigns.goLive(draft.id, sellerId);
    expect(resubmitted.status).toBe('PENDING_REVIEW');
    expect(resubmitted.rejectionReason).toBeNull();
  });
});
