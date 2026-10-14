import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class ManualRefundDto {
  @IsInt()
  @Min(1)
  amount: number;

  @IsString()
  @MinLength(1)
  reason: string;
}
