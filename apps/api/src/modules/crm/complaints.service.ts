import { Injectable, NotFoundException } from '@nestjs/common';
import { ComplaintStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

function generateComplaintNumber(): string {
  return `CMP-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** Spec #24 — submission, assignment, investigation notes, resolution, and spec #25's escalation. */
@Injectable()
export class ComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(customerId: string, subject: string, description: string) {
    const complaint = await this.prisma.complaint.create({
      data: {
        complaintNumber: generateComplaintNumber(),
        customerId,
        subject,
        description,
      },
    });
    await this.prisma.customerTimelineEvent.create({
      data: {
        customerId,
        type: 'COMPLAINT_SUBMITTED',
        description: `Complaint ${complaint.complaintNumber} submitted: ${subject}`,
        relatedType: 'COMPLAINT',
        relatedId: complaint.id,
      },
    });
    return complaint;
  }

  listAll(filters: { status?: ComplaintStatus; assignedStaffId?: string }) {
    return this.prisma.complaint.findMany({
      where: filters,
      include: {
        customer: { select: { firstName: true, lastName: true } },
        assignedStaff: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  listForCustomer(customerId: string) {
    return this.prisma.complaint.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        assignedStaff: { select: { firstName: true, lastName: true } },
        notes: {
          orderBy: { createdAt: 'desc' },
          include: {
            createdByStaff: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!complaint) {
      throw new NotFoundException('Complaint not found');
    }
    return complaint;
  }

  async assign(id: string, staffId: string) {
    await this.get(id);
    return this.prisma.complaint.update({
      where: { id },
      data: { assignedStaffId: staffId, status: ComplaintStatus.ASSIGNED },
    });
  }

  async addNote(id: string, note: string, staffId: string, isInternal = true) {
    await this.get(id);
    if (isInternal) {
      await this.prisma.complaint.update({
        where: { id },
        data: { status: ComplaintStatus.INVESTIGATING },
      });
    }
    return this.prisma.complaintNote.create({
      data: { complaintId: id, note, isInternal, createdByStaffId: staffId },
    });
  }

  async resolve(id: string, resolution: string) {
    const complaint = await this.get(id);
    const updated = await this.prisma.complaint.update({
      where: { id },
      data: {
        status: ComplaintStatus.RESOLVED,
        resolution,
        resolvedAt: new Date(),
      },
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: complaint.customerId },
      include: { identity: { select: { email: true, id: true } } },
    });
    if (customer) {
      await this.notificationsService.sendGeneric(
        customer.identity.email,
        customer.identity.id,
        `Your complaint ${complaint.complaintNumber} has been resolved`,
        resolution,
      );
    }

    return updated;
  }

  /** Spec #25 — a role name (SYSTEM_ROLES value), not a specific staff member, so it applies regardless of who's on duty. */
  async escalate(id: string, toRole: string) {
    await this.get(id);
    return this.prisma.complaint.update({
      where: { id },
      data: { status: ComplaintStatus.ESCALATED, escalatedTo: toRole },
    });
  }
}
