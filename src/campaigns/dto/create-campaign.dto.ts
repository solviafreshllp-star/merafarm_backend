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

export class CreateSlabDto {
  @IsInt()
  @Min(1)
  fromQty: number;

  @IsInt()
  @Min(0)
  price: number;
}

export class CreateCampaignDto {
  @IsString()
  productName: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  farmName: string;

  @IsOptional()
  @IsString()
  unitLabel?: string; // defaults to "dozen" in the DB

  @IsEnum(ScopeType)
  scopeType: ScopeType;

  @IsOptional() @IsString() scopeCity?: string;
  @IsOptional() @IsString() scopePincode?: string;
  @IsOptional() @IsString() scopeLocality?: string;
  @IsOptional() @IsString() scopeSociety?: string;

  @IsInt()
  @Min(1)
  capUnits: number;

  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;

  /** When the produce actually reaches buyers — a separate date range from
   *  the preorder window above, typically right after `endAt` once the
   *  farmer harvests/packs. */
  @IsDateString()
  deliveryStartAt: string;

  @IsDateString()
  deliveryEndAt: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'A campaign needs at least one price slab' })
  @ValidateNested({ each: true })
  @Type(() => CreateSlabDto)
  slabs: CreateSlabDto[];
}
