import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
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
   * an account using the provided name. An optional referralCode on a FIRST
   * signup (never on an existing-user login) attributes a JOINED
   * ReferralEvent to the referral link that brought them in — see TASKS.md
   * 1.5 for why this is JOINED-on-signup rather than something else.
   */
  async verifyOtp(phone: string, code: string, name?: string, referralCode?: string) {
    // Check whether this request can even complete BEFORE consuming the
    // OTP — `otp.verifyOtp()` deletes it on a correct match. If we checked
    // the OTP first, a new number's first attempt (no name yet) would burn
    // the code on a request that was always going to 400, and the
    // frontend's follow-up "what's your name" retry with that same code
    // would then fail as "invalid OTP" even though it was correct.
    let user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user && !name?.trim()) {
      throw new BadRequestException('New number — a name is required to create an account');
    }

    const ok = await this.otp.verifyOtp(phone, code);
    if (!ok) throw new UnauthorizedException('Invalid or expired OTP');

    if (!user) {
      user = await this.prisma.user.create({ data: { phone, name: name!.trim() } });

      if (referralCode) {
        const link = await this.prisma.referralLink.findUnique({ where: { code: referralCode } });
        if (link) {
          await this.prisma.referralEvent.create({
            data: { referralLinkId: link.id, type: 'JOINED', referredUserId: user.id },
          });
        }
      }
    }

    this.assertNotSuspended(user);
    return this.issueToken(user);
  }

  async passwordLogin(phone: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user?.passwordHash) {
      throw new UnauthorizedException('No password set for this number — sign in with OTP instead');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Incorrect password');
    this.assertNotSuspended(user);
    return this.issueToken(user);
  }

  private assertNotSuspended(user: { isSuspended: boolean }) {
    if (user.isSuspended) {
      throw new UnauthorizedException('This account has been suspended. Contact support for help.');
    }
  }

  /** Lets a logged-in (OTP-verified) user set a password for faster future logins. */
  async setPassword(userId: string, password: string) {
    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { ok: true };
  }

  private issueToken(user: { id: string; phone: string; isSeller: boolean; isAdmin: boolean; name: string }) {
    const payload: JwtPayload = { sub: user.id, phone: user.phone, isSeller: user.isSeller, isAdmin: user.isAdmin };
    return {
      accessToken: this.jwt.sign(payload),
      user: { id: user.id, name: user.name, phone: user.phone, isSeller: user.isSeller, isAdmin: user.isAdmin },
    };
  }
}
