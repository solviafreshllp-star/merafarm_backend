import { IsString, IsUrl } from 'class-validator';

export class AddMediaDto {
  @IsString()
  @IsUrl()
  url: string;
}
