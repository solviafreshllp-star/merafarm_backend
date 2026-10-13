/**
 * The price-ladder logic, ported 1:1 from the prototype's
 * `findCurrentIndex` / `chargePriceFor` functions. Kept as pure functions
 * (no DB access) so they're trivially unit-testable and so the exact same
 * logic can be reused wherever pricing needs to be computed — the campaign
 * detail endpoint, the checkout endpoint, and the campaign-listing cards.
 */

export interface Slab {
  fromQty: number;
  price: number;
}

/** Slabs must be sorted ascending by fromQty before calling this. */
export function findCurrentSlabIndex(slabs: Slab[], bookedUnits: number): number {
  let idx = 0;
  for (let i = 0; i < slabs.length; i++) {
    if (bookedUnits >= slabs[i].fromQty) idx = i;
  }
  return idx;
}

export function currentPrice(slabs: Slab[], bookedUnits: number): number {
  const idx = findCurrentSlabIndex(slabs, bookedUnits);
  return slabs[idx].price;
}

/**
 * The core "no-refund-needed" rule: a buyer is charged whatever tier their
 * OWN order quantity lands the campaign in, not the tier that was active
 * before their order. This is what lets checkout avoid creating a refund
 * for a price drop the buyer's own order caused — see the Refund policy
 * copy and the "unlocked this price" UI treatment in the frontend.
 */
export function chargePriceFor(slabs: Slab[], bookedUnitsBefore: number, orderQty: number, capUnits: number): number {
  const afterBooked = Math.min(capUnits, bookedUnitsBefore + orderQty);
  const idx = findCurrentSlabIndex(slabs, afterBooked);
  return slabs[idx].price;
}

export interface NextSlabInfo {
  isLast: boolean;
  nextSlab: Slab | null;
  unitsToNextSlab: number | null;
}

export function nextSlabInfo(slabs: Slab[], bookedUnits: number): NextSlabInfo {
  const idx = findCurrentSlabIndex(slabs, bookedUnits);
  const isLast = idx === slabs.length - 1;
  if (isLast) return { isLast: true, nextSlab: null, unitsToNextSlab: null };
  const nextSlab = slabs[idx + 1];
  return { isLast: false, nextSlab, unitsToNextSlab: nextSlab.fromQty - bookedUnits };
}
