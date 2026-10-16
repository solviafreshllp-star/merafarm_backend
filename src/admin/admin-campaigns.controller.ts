import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { CampaignStatus } from '@prisma/client';
import { CampaignsService } from '../campaigns/campaigns.service';
import { AdminUpdateCampaignDto } from '../campaigns/dto/admin-update-campaign.dto';
import { RejectCampaignDto } from './dto/reject-campaign.dto';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/campaigns')
export class AdminCampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly admin: AdminService,
  ) {}

  /** Every campaign across every seller, optionally filtered by status —
   *  the approval queue (`?status=PENDING_REVIEW`) and campaign management
   *  (no filter) screens both use this. */
  @Get()
  list(@Query('status') status?: CampaignStatus) {
    return this.campaigns.adminList({ status });
  }

  @Patch(':id/approve')
  async approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const result = await this.campaigns.approve(id);
    await this.admin.logAction(user.sub, 'campaign.approve', 'Campaign', id);
    return result;
  }

  @Patch(':id/reject')
  async reject(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: RejectCampaignDto) {
    const result = await this.campaigns.reject(id, dto.reason);
    await this.admin.logAction(user.sub, 'campaign.reject', 'Campaign', id, { reason: dto.reason });
    return result;
  }

  /** Full-edit, bypassing the seller-ownership check the seller's own PATCH endpoints enforce. */
  @Patch(':id')
  async edit(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: AdminUpdateCampaignDto) {
    const result = await this.campaigns.adminUpdate(id, dto);
    await this.admin.logAction(user.sub, 'campaign.edit', 'Campaign', id, dto);
    return result;
  }
}
