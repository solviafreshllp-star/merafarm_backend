import { IsOptional, IsString, MinLength } from 'class-validator';

export class BroadcastNotificationDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsString()
  @MinLength(1)
  body: string;

  /** Omit to broadcast to every user; set to target only buyers/referrers of one campaign. */
  @IsOptional()
  @IsString()
  campaignId?: string;
}
