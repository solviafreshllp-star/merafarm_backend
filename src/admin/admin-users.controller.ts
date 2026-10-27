import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/upsert-address.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { ComplaintsService } from '../complaints/complaints.service';
import { RefundsService } from '../refunds/refunds.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly admin: AdminService,
    private readonly complaints: ComplaintsService,
    private readonly refunds: RefundsService,
  ) {}

  @Get()
  list(@Query('isSeller') isSeller?: string, @Query('isAdmin') isAdmin?: string, @Query('q') q?: string) {
    return this.admin.listUsers({
      isSeller: isSeller === undefined ? undefined : isSeller === 'true',
      isAdmin: isAdmin === undefined ? undefined : isAdmin === 'true',
      q,
    });
  }

  /** Customer profile screen: contact + saved addresses. */
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.admin.getUserDetail(id);
  }

  @Get(':id/orders')
  orders(@Param('id') id: string) {
    return this.admin.getUserOrders(id);
  }

  @Get(':id/complaints')
  complaintsForUser(@Param('id') id: string) {
    return this.complaints.adminList({ userId: id });
  }

  @Get(':id/refunds')
  refundsForUser(@Param('id') id: string) {
    return this.refunds.adminList({ userId: id });
  }

  @Patch(':id')
  async update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    const result = await this.admin.updateUser(id, dto);
    await this.admin.logAction(user.sub, 'user.update', 'User', id, dto);
    return result;
  }

  @Post(':id/addresses')
  async addAddress(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: CreateAddressDto) {
    const result = await this.admin.createAddress(id, dto);
    await this.admin.logAction(user.sub, 'address.create', 'User', id, dto);
    return result;
  }

  @Patch(':id/addresses/:addressId')
  async editAddress(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('addressId') addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    const result = await this.admin.updateAddress(id, addressId, dto);
    await this.admin.logAction(user.sub, 'address.update', 'Address', addressId, dto);
    return result;
  }
}
