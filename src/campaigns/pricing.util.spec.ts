import { chargePriceFor, currentPrice, findCurrentSlabIndex, nextSlabInfo, Slab } from './pricing.util';

const slabs: Slab[] = [
  { fromQty: 1, price: 2000 },
  { fromQty: 10, price: 1850 },
  { fromQty: 20, price: 1700 },
  { fromQty: 30, price: 1550 },
];

describe('findCurrentSlabIndex', () => {
  it('returns the first slab when booked is below every threshold but the first', () => {
    expect(findCurrentSlabIndex(slabs, 1)).toBe(0);
    expect(findCurrentSlabIndex(slabs, 9)).toBe(0);
  });

  it('returns the exact slab when booked lands exactly on a threshold', () => {
    expect(findCurrentSlabIndex(slabs, 10)).toBe(1);
    expect(findCurrentSlabIndex(slabs, 30)).toBe(3);
  });

  it('returns the last slab once booked exceeds every threshold', () => {
    expect(findCurrentSlabIndex(slabs, 999)).toBe(3);
  });
});

describe('currentPrice', () => {
  it('matches the prototype scenario: 23 booked -> ₹1700', () => {
    expect(currentPrice(slabs, 23)).toBe(1700);
  });
});

describe('chargePriceFor — the no-refund-needed rule', () => {
  it('charges the pre-order price when the order does not cross a threshold', () => {
    // 23 booked, ordering 3 -> 26, still within the 20-29 slab (₹1700)
    expect(chargePriceFor(slabs, 23, 3, 60)).toBe(1700);
  });

  it("charges the buyer's own unlocked price when their order crosses a threshold", () => {
    // 23 booked, ordering 7 -> exactly 30, crosses into the ₹1550 slab
    expect(chargePriceFor(slabs, 23, 7, 60)).toBe(1550);
  });

  it('never lets an order push bookings past the campaign cap', () => {
    // cap is 60; 55 booked + ordering 10 should clamp to 60, not 65
    expect(chargePriceFor(slabs, 55, 10, 60)).toBe(currentPrice(slabs, 60));
  });
});

describe('nextSlabInfo', () => {
  it('reports units remaining to the next slab', () => {
    const info = nextSlabInfo(slabs, 23);
    expect(info.isLast).toBe(false);
    expect(info.nextSlab?.price).toBe(1550);
    expect(info.unitsToNextSlab).toBe(7);
  });

  it('reports isLast once the lowest slab is reached', () => {
    const info = nextSlabInfo(slabs, 30);
    expect(info.isLast).toBe(true);
    expect(info.nextSlab).toBeNull();
  });
});
