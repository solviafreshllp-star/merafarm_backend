import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional, IsString, ValidateNested } from 'class-validator';

/**
 * One address for the whole cart. Which fields are actually required
 * depends on each campaign's own scopeType — see address-scope.util.ts,
 * applied per-campaign-item during checkout.
 */
export class CheckoutAddressDto {
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() pincode?: string;
  @IsOptional() @IsString() locality?: string;
  @IsOptional() @IsString() society?: string;

  @IsString()
  flat: string;

  @IsOptional() @IsString() wing?: string;
  @IsOptional() @IsString() landmark?: string;
  @IsOptional() @IsString() deliveryNote?: string;

  // Map pin captured at checkout (current-location tap or a pasted Google
  // Maps link) — always optional, never locked by campaign scope.
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
}

export class CheckoutDto {
  @ValidateNested()
  @Type(() => CheckoutAddressDto)
  address: CheckoutAddressDto;
}

export class ConfirmCheckoutDto {
  @IsString()
  razorpayOrderId: string;

  @IsString()
  razorpayPaymentId: string;

  @IsString()
  razorpaySignature: string;
}
