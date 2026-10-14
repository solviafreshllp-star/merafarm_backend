import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateUserDto {
  @IsOptional() @IsBoolean() isSeller?: boolean;
  @IsOptional() @IsBoolean() isAdmin?: boolean;
  @IsOptional() @IsBoolean() isSuspended?: boolean;
}
