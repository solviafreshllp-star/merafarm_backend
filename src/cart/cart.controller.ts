import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CartService } from './cart.service';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart-item.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';

@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  getCart(@CurrentUser() user: JwtPayload) {
    return this.cart.getCart(user.sub);
  }

  @Post('items')
  addItem(@CurrentUser() user: JwtPayload, @Body() dto: AddCartItemDto) {
    return this.cart.addItem(user.sub, dto.campaignId, dto.quantity);
  }

  @Patch('items/:campaignId')
  updateItem(
    @CurrentUser() user: JwtPayload,
    @Param('campaignId') campaignId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.updateItem(user.sub, campaignId, dto.quantity);
  }

  @Delete('items/:campaignId')
  removeItem(@CurrentUser() user: JwtPayload, @Param('campaignId') campaignId: string) {
    return this.cart.removeItem(user.sub, campaignId);
  }
}
