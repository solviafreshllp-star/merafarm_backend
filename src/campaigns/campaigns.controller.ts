import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCapDto } from './dto/update-cap.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  findLive(@Query('city') city?: string) {
    return this.campaigns.findLive({ city });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.campaigns.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/cap')
  updateCap(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateCapDto) {
    return this.campaigns.updateCap(id, user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/go-live')
  goLive(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.campaigns.goLive(id, user.sub);
  }
}
