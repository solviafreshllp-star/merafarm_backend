import { BadRequestException } from '@nestjs/common';
import { Campaign, ScopeType } from '@prisma/client';

/** Mirrors the prototype's LEVEL_DEPTH hierarchy exactly. */
const LEVEL_DEPTH: Record<ScopeType, number> = {
  NATIONAL: 0,
  CITY: 1,
  PINCODE: 2,
  LOCALITY: 3,
  SOCIETY: 4,
};

export interface BuyerAddressInput {
  city?: string;
  pincode?: string;
  locality?: string;
  society?: string;
  flat: string;
  wing?: string;
  landmark?: string;
  deliveryNote?: string;
}

export interface ResolvedAddress {
  addressCity: string;
  addressPincode: string;
  addressLocality: string;
  addressSociety: string;
  addressFlat: string;
  addressWing?: string;
  addressLandmark?: string;
  deliveryNote?: string;
}

/**
 * Server-side enforcement of the address-scope locking rule (see TASKS.md
 * 1.16 and the prototype's LEVEL_DEPTH logic): fields AT OR ABOVE the
 * campaign's own scope depth are frozen from the campaign record and never
 * trusted from client input — a buyer can't spoof a cheaper or mismatched
 * delivery scope that way. Fields BELOW the campaign's scope depth (more
 * specific than what the campaign itself locks in) are required from, and
 * only ever taken from, the buyer.
 *
 * Example: a CITY-scoped campaign only locks in the city — pincode,
 * locality, and society must come from the buyer. A SOCIETY-scoped
 * campaign locks in everything down to the society, so the buyer only ever
 * supplies the flat/wing/landmark.
 */
export function resolveOrderAddress(campaign: Campaign, buyer: BuyerAddressInput): ResolvedAddress {
  const depth = LEVEL_DEPTH[campaign.scopeType];
  const missing: string[] = [];

  const pick = (fieldDepth: number, campaignValue: string | null, buyerValue: string | undefined, label: string) => {
    if (fieldDepth <= depth) return campaignValue ?? '';
    if (!buyerValue?.trim()) missing.push(label);
    return buyerValue?.trim() ?? '';
  };

  const addressCity = pick(1, campaign.scopeCity, buyer.city, 'city');
  const addressPincode = pick(2, campaign.scopePincode, buyer.pincode, 'pincode');
  const addressLocality = pick(3, campaign.scopeLocality, buyer.locality, 'locality');
  const addressSociety = pick(4, campaign.scopeSociety, buyer.society, 'society');

  if (missing.length) {
    throw new BadRequestException(`Missing required address field(s): ${missing.join(', ')}`);
  }

  return {
    addressCity,
    addressPincode,
    addressLocality,
    addressSociety,
    addressFlat: buyer.flat,
    addressWing: buyer.wing,
    addressLandmark: buyer.landmark,
    deliveryNote: buyer.deliveryNote,
  };
}
