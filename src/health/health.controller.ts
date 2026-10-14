import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deliberately doesn't check Redis — OtpService and the refunds queue
   * degrade (OTP falls back to in-memory, refunds just queue up) rather
   * than fail outright when Redis is down, so a Redis outage shouldn't by
   * itself flip a deploy/monitoring check to unhealthy. Database
   * connectivity is the one dependency this API genuinely cannot run without.
   */
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up', timestamp: new Date().toISOString() };
    } catch {
      // 503 so a load balancer / k8s liveness probe actually treats this as unhealthy, not a 200 to parse.
      throw new ServiceUnavailableException({ status: 'degraded', database: 'down', timestamp: new Date().toISOString() });
    }
  }
}
