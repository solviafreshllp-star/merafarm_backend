import { Module } from '@nestjs/common';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { RazorpayService } from './razorpay.service';
import { OrdersModule } from '../orders/orders.module';
import { CartModule } from '../cart/cart.module';

@Module({
  imports: [OrdersModule, CartModule],
  controllers: [PaymentsWebhookController],
  providers: [RazorpayService],
})
export class PaymentsModule {}
