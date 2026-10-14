import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CheckoutService } from './checkout.service';
import { CheckoutDto, ConfirmCheckoutDto } from './dto/checkout.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@UseGuards(JwtAuthGuard)
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  // Same abuse surface as single-order creation (see orders.controller.ts) — tighter than the global default.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  checkoutCart(@CurrentUser() user: JwtPayload, @Body() dto: CheckoutDto) {
    return this.checkout.checkout(user.sub, dto);
  }

  @Post(':groupId/confirm')
  confirm(@CurrentUser() user: JwtPayload, @Param('groupId') groupId: string, @Body() dto: ConfirmCheckoutDto) {
    return this.checkout.confirm(user.sub, groupId, dto);
  }
}
