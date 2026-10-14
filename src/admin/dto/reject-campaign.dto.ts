import { IsString, MinLength } from 'class-validator';

export class RejectCampaignDto {
  @IsString()
  @MinLength(1)
  reason: string;
}
