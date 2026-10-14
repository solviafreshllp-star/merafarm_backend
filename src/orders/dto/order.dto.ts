import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  campaignId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  // Address — only the fields BELOW the campaign's scope depth are actually
  // required/used; city/pincode/locality/society AT OR ABOVE that depth are
  // always taken from the campaign itself, never trusted from client input,
  // since a buyer could otherwise spoof a cheaper/wrong scope onto their
  // delivery (see address-scope.util.ts). Which of these are required
  // depends on the campaign's own scopeType, so all are optional here and
  // validated against the actual campaign server-side.
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() pincode?: string;
  @IsOptional() @IsString() locality?: string;
  @IsOptional() @IsString() society?: string;

  @IsString()
  flat: string;

  @IsOptional() @IsString() wing?: string;
  @IsOptional() @IsString() landmark?: string;
  @IsOptional() @IsString() deliveryNote?: string;

  @IsOptional() @IsString() referralCode?: string;
}

export class ConfirmPaymentDto {
  @IsString()
  razorpayOrderId: string;

  @IsString()
  razorpayPaymentId: string;

  @IsString()
  razorpaySignature: string;
}
