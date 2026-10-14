import { IsInt, IsString, Min } from 'class-validator';

export class AddCartItemDto {
  @IsString()
  campaignId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class UpdateCartItemDto {
  @IsInt()
  @Min(1)
  quantity: number;
}
