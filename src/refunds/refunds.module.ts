import { Module } from '@nestjs/common';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [JobsModule],
  controllers: [RefundsController],
  providers: [RefundsService],
  exports: [RefundsService],
})
export class RefundsModule {}
