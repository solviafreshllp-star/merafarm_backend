import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ComplaintStatus } from '@prisma/client';
import { ComplaintsService } from '../complaints/complaints.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

/** Resolving a complaint is still `PATCH /complaints/:id/resolve` (already
 *  admin-guarded there) — this controller only adds the missing queue/
 *  search surface so an admin can find a complaint id to act on. */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/complaints')
export class AdminComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  list(@Query('q') q?: string, @Query('status') status?: ComplaintStatus) {
    return this.complaints.adminList({ q, status });
  }
}
