import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  list(@Query('isSeller') isSeller?: string, @Query('isAdmin') isAdmin?: string, @Query('q') q?: string) {
    return this.admin.listUsers({
      isSeller: isSeller === undefined ? undefined : isSeller === 'true',
      isAdmin: isAdmin === undefined ? undefined : isAdmin === 'true',
      q,
    });
  }

  @Patch(':id')
  async update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    const result = await this.admin.updateUser(id, dto);
    await this.admin.logAction(user.sub, 'user.update', 'User', id, dto);
    return result;
  }
}
