import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Spec #23 — never auto-published; isApproved gates visibility everywhere it's read back. */
@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    customerId: string,
    dto: {
      serviceType: string;
      sourceType?: string;
      sourceId?: string;
      rating: number;
      staffRating?: number;
      comment?: string;
      staffId?: string;
    },
  ) {
    const feedback = await this.prisma.customerFeedback.create({
      data: { customerId, ...dto },
    });
    await this.prisma.customerTimelineEvent.create({
      data: {
        customerId,
        type: 'FEEDBACK_SUBMITTED',
        description: `Feedback submitted for ${dto.serviceType} (rating ${dto.rating}/5)`,
      },
    });
    return feedback;
  }

  listAll(filters: { isApproved?: boolean; serviceType?: string }) {
    return this.prisma.customerFeedback.findMany({
      where: filters,
      include: {
        customer: { select: { firstName: true, lastName: true } },
        staff: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  listForCustomer(customerId: string) {
    return this.prisma.customerFeedback.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approve(id: string, approvedByStaffId: string) {
    const existing = await this.prisma.customerFeedback.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Feedback not found');
    }
    return this.prisma.customerFeedback.update({
      where: { id },
      data: { isApproved: true, approvedByStaffId },
    });
  }
}
