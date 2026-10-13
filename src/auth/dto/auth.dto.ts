import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @Matches(/^\d{10}$/, { message: 'phone must be a 10-digit number' })
  phone: string;
}

export class VerifyOtpDto {
  @IsString()
  @Matches(/^\d{10}$/, { message: 'phone must be a 10-digit number' })
  phone: string;

  @IsString()
  @Length(4, 4)
  otp: string;

  // Only needed the first time — an existing user is recognized by phone
  // and this is ignored.
  @IsOptional()
  @IsString()
  name?: string;
}

export class PasswordLoginDto {
  @IsString()
  @Matches(/^\d{10}$/)
  phone: string;

  @IsString()
  password: string;
}
