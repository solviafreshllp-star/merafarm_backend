import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsBoolean() isSeller?: boolean;
  @IsOptional() @IsBoolean() isAdmin?: boolean;
  @IsOptional() @IsBoolean() isSuspended?: boolean;
}
