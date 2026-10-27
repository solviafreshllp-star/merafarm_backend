import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ComplaintStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { ResolveComplaintDto } from './dto/resolve-complaint.dto';

@Injectable()
export class ComplaintsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateComplaintDto) {
    const order = await this.prisma.order.findUnique({ where: { id: dto.orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('Not your order');

    return this.prisma.complaint.create({
      data: {
        orderId: dto.orderId,
        userId,
        category: dto.category,
        description: dto.description,
      },
    });
  }

  async myComplaints(userId: string) {
    return this.prisma.complaint.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Admin-facing search across every buyer's complaints — by complaint id
   * (exact) or the complaining user's name/phone (contains, case-
   * insensitive for name), optionally narrowed by status.
   */
  async adminList(params: { q?: string; status?: ComplaintStatus; userId?: string }) {
    const q = params.q?.trim();
    return this.prisma.complaint.findMany({
      where: {
        ...(params.userId ? { userId: params.userId } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(q
          ? {
              OR: [
                { id: q },
                { user: { name: { contains: q, mode: 'insensitive' } } },
                { user: { phone: { contains: q } } },
              ],
            }
          : {}),
      },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        order: { select: { orderNumber: true, amount: true, campaign: { select: { productName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolve(id: string, dto: ResolveComplaintDto) {
    const complaint = await this.prisma.complaint.findUnique({ where: { id } });
    if (!complaint) throw new NotFoundException('Complaint not found');
    return this.prisma.complaint.update({
      where: { id },
      data: { status: ComplaintStatus.RESOLVED, resolutionNote: dto.resolutionNote, resolvedAt: new Date() },
    });
  }
}
