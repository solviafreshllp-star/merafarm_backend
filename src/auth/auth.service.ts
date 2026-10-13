import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { JwtPayload } from './jwt-payload';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly jwt: JwtService,
  ) {}

  async requestOtp(phone: string) {
    await this.otp.requestOtp(phone);
    return { sent: true };
  }

  /**
   * Mirrors the prototype's sign-in/sign-up split: an existing phone number
   * logs the user straight in (no name re-asked); an unseen number creates
   * an account using the provided name.
   */
  async verifyOtp(phone: string, code: string, name?: string) {
    const ok = await this.otp.verifyOtp(phone, code);
    if (!ok) throw new UnauthorizedException('Invalid or expired OTP');

    let user = await this.prisma.user.findUnique({ where: { phone } });

    if (!user) {
      if (!name?.trim()) {
        throw new BadRequestException('New number — a name is required to create an account');
      }
      user = await this.prisma.user.create({ data: { phone, name: name.trim() } });
    }

    return this.issueToken(user);
  }

  async passwordLogin(phone: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user?.passwordHash) {
      throw new UnauthorizedException('No password set for this number — sign in with OTP instead');
    }
    const hash = this.hashPassword(password);
    if (hash !== user.passwordHash) throw new UnauthorizedException('Incorrect password');
    return this.issueToken(user);
  }

  /** Lets a logged-in (OTP-verified) user set a password for faster future logins. */
  async setPassword(userId: string, password: string) {
    const passwordHash = this.hashPassword(password);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { ok: true };
  }

  private hashPassword(password: string): string {
    // Placeholder only — swap for bcrypt/argon2 before this touches real
    // passwords. Flagging explicitly rather than letting a plain SHA-256
    // hash look production-ready.
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  private issueToken(user: { id: string; phone: string; isSeller: boolean; name: string }) {
    const payload: JwtPayload = { sub: user.id, phone: user.phone, isSeller: user.isSeller };
    return {
      accessToken: this.jwt.sign(payload),
      user: { id: user.id, name: user.name, phone: user.phone, isSeller: user.isSeller },
    };
  }
}
