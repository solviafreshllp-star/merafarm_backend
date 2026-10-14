import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCapDto } from './dto/update-cap.dto';
import { AddMediaDto } from './dto/add-media.dto';
import { CloudflareImagesService } from '../media/cloudflare-images.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly cloudflareImages: CloudflareImagesService,
  ) {}

  @Get()
  findLive(@Query('city') city?: string) {
    return this.campaigns.findLive({ city });
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  findMine(@CurrentUser() user: JwtPayload) {
    return this.campaigns.findMine(user.sub);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.campaigns.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/orders')
  findOrders(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.campaigns.findOrdersFor(id, user.sub);
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

  /** Requests a one-time Cloudflare Images direct-upload URL — the binary itself never touches this API. */
  @UseGuards(JwtAuthGuard)
  @Post(':id/media/upload-url')
  async requestMediaUploadUrl(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.campaigns.verifyOwnership(id, user.sub);
    return this.cloudflareImages.requestDirectUploadUrl();
  }

  /** Called once the frontend has finished uploading directly to Cloudflare, to persist the resulting URL. */
  @UseGuards(JwtAuthGuard)
  @Patch(':id/media')
  addMedia(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: AddMediaDto) {
    return this.campaigns.addMediaUrl(id, user.sub, dto.url);
  }
}
