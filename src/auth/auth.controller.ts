import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RequestOtpDto, VerifyOtpDto, PasswordLoginDto } from './dto/auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { JwtPayload } from './jwt-payload';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle({ default: { limit: 3, ttl: 60_000 } }) // rate-limit OTP requests, this is an SMS-cost + abuse surface
  @Post('request-otp')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Post('verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.otp, dto.name, dto.referralCode);
  }

  @Post('login')
  passwordLogin(@Body() dto: PasswordLoginDto) {
    return this.auth.passwordLogin(dto.phone, dto.password);
  }

  @UseGuards(JwtAuthGuard)
  @Post('set-password')
  setPassword(@CurrentUser() user: JwtPayload, @Body('password') password: string) {
    return this.auth.setPassword(user.sub, password);
  }
}
