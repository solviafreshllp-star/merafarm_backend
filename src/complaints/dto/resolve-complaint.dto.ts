import { IsOptional, IsString } from 'class-validator';

export class ResolveComplaintDto {
  @IsOptional()
  @IsString()
  resolutionNote?: string;
}
