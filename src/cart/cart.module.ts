import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { OrdersModule } from '../orders/orders.module';
import { RazorpayService } from '../payments/razorpay.service';

@Module({
  imports: [CampaignsModule, OrdersModule],
  controllers: [CartController, CheckoutController],
  providers: [CartService, CheckoutService, RazorpayService],
})
export class CartModule {}
