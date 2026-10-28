import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { OrdersModule } from './orders/orders.module';
import { ComplaintsModule } from './complaints/complaints.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReferralsModule } from './referrals/referrals.module';
import { CartModule } from './cart/cart.module';
import { AdminModule } from './admin/admin.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RefundsModule } from './refunds/refunds.module';
import { HealthModule } from './health/health.module';
import { PaymentsModule } from './payments/payments.module';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]), // sane default; auth endpoints tighten this further
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    PrismaModule,
    RealtimeModule,
    NotificationsModule,
    AuthModule,
    CampaignsModule,
    OrdersModule,
    ComplaintsModule,
    ReferralsModule,
    CartModule,
    AdminModule,
    RefundsModule,
    HealthModule,
    PaymentsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
