import { IsString } from 'class-validator';

export class CreateComplaintDto {
  @IsString()
  orderId: string;

  @IsString()
  category: string; // "Quality issue" | "Missing items" | "Wrong item delivered" | "Delivery delay" | "Other"

  @IsString()
  description: string;
}
