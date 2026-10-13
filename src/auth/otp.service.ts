import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';

/**
 * OTPs live in memory for this scaffold — swap for Redis (with a TTL) the
 * moment this runs on more than one instance, since in-memory state won't
 * be shared across processes.
 *
 * The "send" step just logs to the console in development. Swap in
 * MSG91 / Twilio / Firebase Auth here for production — the interface
 * (requestOtp / verifyOtp) is what the rest of the app depends on, so the
 * provider is a one-file change.
 */
@Injectable()
export class OtpService {
  private readonly pending = new Map<string, { code: string; expiresAt: number }>();
  private readonly TTL_MS = 5 * 60 * 1000;

  async requestOtp(phone: string): Promise<void> {
    const code = String(randomInt(1000, 9999));
    this.pending.set(phone, { code, expiresAt: Date.now() + this.TTL_MS });

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
    const entry = this.pending.get(phone);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.pending.delete(phone);
      return false;
    }
    const ok = entry.code === code;
    if (ok) this.pending.delete(phone); // one-time use
    return ok;
  }
}
