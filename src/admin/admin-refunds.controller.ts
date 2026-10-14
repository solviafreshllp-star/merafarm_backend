import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RefundStatus } from '@prisma/client';
import { RefundsService } from '../refunds/refunds.service';
import { ManualRefundDto } from './dto/manual-refund.dto';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminRefundsController {
  constructor(
    private readonly refunds: RefundsService,
    private readonly admin: AdminService,
  ) {}

  @Get('refunds')
  list(@Query('status') status?: RefundStatus, @Query('campaignId') campaignId?: string) {
    return this.refunds.adminList({ status, campaignId });
  }

  @Post('orders/:id/refund')
  async manual(@CurrentUser() user: JwtPayload, @Param('id') orderId: string, @Body() dto: ManualRefundDto) {
    const result = await this.refunds.manualRefund(orderId, dto.amount, dto.reason);
    await this.admin.logAction(user.sub, 'refund.manual', 'Order', orderId, dto);
    return result;
  }

  @Patch('refunds/:id/retry')
  async retry(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const result = await this.refunds.retry(id);
    await this.admin.logAction(user.sub, 'refund.retry', 'Refund', id);
    return result;
  }
}
