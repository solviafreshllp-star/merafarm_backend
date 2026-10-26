import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ScopeType } from '@prisma/client';
import { CreateSlabDto } from './create-campaign.dto';

/** Every field optional — admins can patch just the fields they're changing. */
export class AdminUpdateCampaignDto {
  @IsOptional() @IsString() productName?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() farmName?: string;
  @IsOptional() @IsString() unitLabel?: string;

  @IsOptional() @IsEnum(ScopeType) scopeType?: ScopeType;
  @IsOptional() @IsString() scopeCity?: string;
  @IsOptional() @IsString() scopePincode?: string;
  @IsOptional() @IsString() scopeLocality?: string;
  @IsOptional() @IsString() scopeSociety?: string;

  @IsOptional() @IsInt() @Min(1) capUnits?: number;

  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsDateString() deliveryStartAt?: string;
  @IsOptional() @IsDateString() deliveryEndAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'A campaign needs at least one price slab' })
  @ValidateNested({ each: true })
  @Type(() => CreateSlabDto)
  slabs?: CreateSlabDto[];
}
