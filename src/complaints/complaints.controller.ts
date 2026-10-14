import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ComplaintsService } from './complaints.service';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { ResolveComplaintDto } from './dto/resolve-complaint.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@UseGuards(JwtAuthGuard)
@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateComplaintDto) {
    return this.complaints.create(user.sub, dto);
  }

  @Get('me')
  mine(@CurrentUser() user: JwtPayload) {
    return this.complaints.myComplaints(user.sub);
  }

  @UseGuards(AdminGuard)
  @Patch(':id/resolve')
  resolve(@Param('id') id: string, @Body() dto: ResolveComplaintDto) {
    return this.complaints.resolve(id, dto);
  }
}
