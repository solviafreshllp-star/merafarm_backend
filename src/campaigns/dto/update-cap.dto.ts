import { IsInt, Min } from 'class-validator';

export class UpdateCapDto {
  @IsInt()
  @Min(1)
  capUnits: number;
}
