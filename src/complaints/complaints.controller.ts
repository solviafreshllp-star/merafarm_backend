import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ComplaintsService } from './complaints.service';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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
}
