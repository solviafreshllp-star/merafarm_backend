import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { CreateReferralDto } from './dto/create-referral.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@UseGuards(JwtAuthGuard)
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateReferralDto) {
    return this.referrals.getOrCreate(user.sub, dto.campaignId);
  }

  @Get('me/stats')
  myStats(@CurrentUser() user: JwtPayload) {
    return this.referrals.stats(user.sub);
  }

  @Get('me/:campaignId')
  mine(@CurrentUser() user: JwtPayload, @Param('campaignId') campaignId: string) {
    return this.referrals.findMine(user.sub, campaignId);
  }

  @Post(':code/share-ping')
  sharePing(@CurrentUser() user: JwtPayload, @Param('code') code: string) {
    return this.referrals.sharePing(user.sub, code);
  }
}
