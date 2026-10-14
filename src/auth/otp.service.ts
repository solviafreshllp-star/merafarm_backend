import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomInt } from 'crypto';
import Redis from 'ioredis';

/**
 * OTPs live in Redis (same instance BullMQ already uses) with a 5-minute
 * TTL, so they survive a process restart and work across multiple API
 * instances — in-memory storage would silently break the moment this runs
 * behind more than one replica.
 *
 * Falls back to an in-memory Map if Redis is unreachable (fails fast via
 * maxRetriesPerRequest/retryStrategy below rather than hanging requests).
 * This is a LOCAL-DEV RESILIENCE NET, not a design choice — a production
 * deploy should always have Redis up, and the fallback means OTPs issued
 * during an outage still won't survive a restart or work across replicas,
 * same limitation the in-memory-only version had.
 *
 * The "send" step just logs to the console in development. Swap in
 * MSG91 / Twilio / Firebase Auth here for production — the interface
 * (requestOtp / verifyOtp) is what the rest of the app depends on, so the
 * provider is a one-file change.
 */
@Injectable()
export class OtpService implements OnModuleDestroy {
  private readonly logger = new Logger(OtpService.name);
  private readonly redis = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    connectTimeout: 1000,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => (times > 2 ? null : 200),
    lazyConnect: true,
  });
  private readonly memoryFallback = new Map<string, { code: string; expiresAt: number }>();
  private readonly TTL_SECONDS = 5 * 60;

  async requestOtp(phone: string): Promise<void> {
    const code = String(randomInt(1000, 9999));

    try {
      await this.redis.set(this.key(phone), code, 'EX', this.TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Redis unavailable for OTP storage, falling back to in-memory store: ${err}`);
      this.memoryFallback.set(phone, { code, expiresAt: Date.now() + this.TTL_SECONDS * 1000 });
    }

    if (process.env.OTP_PROVIDER === 'console' || !process.env.OTP_PROVIDER) {
      // eslint-disable-next-line no-console
      console.log(`[OTP] ${phone} -> ${code} (expires in 5 min)`);
      return;
    }

    // TODO: wire the real provider here, e.g.:
    // if (process.env.OTP_PROVIDER === 'msg91') { ... }
    throw new Error(`Unknown OTP_PROVIDER: ${process.env.OTP_PROVIDER}`);
  }

  async verifyOtp(phone: string, code: string): Promise<boolean> {
    try {
      const stored = await this.redis.get(this.key(phone));
      if (stored !== null) {
        const ok = stored === code;
        if (ok) await this.redis.del(this.key(phone));
        return ok;
      }
    } catch (err) {
      this.logger.warn(`Redis unavailable for OTP verification, checking in-memory fallback: ${err}`);
    }

    const entry = this.memoryFallback.get(phone);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.memoryFallback.delete(phone);
      return false;
    }
    const ok = entry.code === code;
    if (ok) this.memoryFallback.delete(phone);
    return ok;
  }

  async onModuleDestroy() {
    this.redis.disconnect();
  }

  private key(phone: string): string {
    return `otp:${phone}`;
  }
}
