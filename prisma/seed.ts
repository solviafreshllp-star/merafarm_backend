/**
 * Seeds a demo seller, a demo buyer, and the Ratnagiri Alphonso campaign
 * with the same price ladder used throughout the prototype, so the API
 * has something real to return on first run.
 *
 * Run with: npm run seed
 */
import { PrismaClient, ScopeType, CampaignStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const seller = await prisma.user.upsert({
    where: { phone: '9876500001' },
    update: {},
    create: {
      name: 'Konkan Fresh Farms',
      phone: '9876500001',
      isSeller: true,
    },
  });

  const buyer = await prisma.user.upsert({
    where: { phone: '9820045671' },
    update: {},
    create: {
      name: 'Priya Sharma',
      phone: '9820045671',
    },
  });

  const now = new Date();
  const start = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + (1 * 24 + 14) * 60 * 60 * 1000);

  const campaign = await prisma.campaign.create({
    data: {
      productName: 'Ratnagiri Alphonso',
      description:
        'Hand-picked Alphonso mangoes from Ratnagiri, ripened naturally and shipped within 48 hours of harvest. Each box has about 24 mangoes.',
      farmName: 'Konkan Fresh Farms',
      unitLabel: 'dozen',
      sellerId: seller.id,
      scopeType: ScopeType.SOCIETY,
      scopeCity: 'Mumbai',
      scopePincode: '400076',
      scopeLocality: 'Powai',
      scopeSociety: 'Hiranandani Gardens',
      capUnits: 60,
      bookedUnits: 23,
      status: CampaignStatus.LIVE,
      startAt: start,
      endAt: end,
      slabs: {
        create: [
          { fromQty: 1, price: 2000 },
          { fromQty: 10, price: 1850 },
          { fromQty: 20, price: 1700 },
          { fromQty: 30, price: 1550 },
        ],
      },
    },
  });

  console.log('Seeded:', { seller: seller.phone, buyer: buyer.phone, campaign: campaign.id });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
