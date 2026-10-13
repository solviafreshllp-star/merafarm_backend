import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  campaignId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  // Address — only the fields BELOW the campaign's scope depth are actually
  // used; city/pincode/locality/society above that depth are always taken
  // from the campaign itself, never trusted from client input, since a
  // buyer could otherwise spoof a cheaper/wrong scope onto their delivery.
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
