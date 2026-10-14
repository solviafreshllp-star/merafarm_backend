import { Controller, Get, UseGuards } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@UseGuards(JwtAuthGuard)
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get('me')
  mine(@CurrentUser() user: JwtPayload) {
    return this.refunds.myRefunds(user.sub);
  }
}
