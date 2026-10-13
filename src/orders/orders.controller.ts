import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto, ConfirmPaymentDto } from './dto/order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

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
