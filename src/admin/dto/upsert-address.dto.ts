import { IsBoolean, IsLatitude, IsLongitude, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateAddressDto {
  @IsString() @MinLength(1) flat!: string;
  @IsOptional() @IsString() wing?: string;
  @IsOptional() @IsString() landmark?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
}

export class UpdateAddressDto {
  @IsOptional() @IsString() @MinLength(1) flat?: string;
  @IsOptional() @IsString() wing?: string;
  @IsOptional() @IsString() landmark?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
}
