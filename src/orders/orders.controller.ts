import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from './orders.service';
import { CreateOrderDto, ConfirmPaymentDto } from './dto/order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  // Tighter than the global default (100/60s) — order creation races a
  // price-slab threshold, so it's a scalping/abuse surface the same way OTP
  // requests are a cost surface.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateOrderDto) {
    return this.orders.createOrder(user.sub, dto);
  }

  @Post(':id/confirm')
  confirm(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ConfirmPaymentDto) {
    return this.orders.confirmPayment(user.sub, id, dto);
  }

  @Get('me')
  myOrders(@CurrentUser() user: JwtPayload) {
    return this.orders.myOrders(user.sub);
  }
}
