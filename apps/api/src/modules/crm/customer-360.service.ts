import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Spec #1's 360-degree customer view. Reads across every module already
 * built rather than duplicating any of their data — this is purely a
 * read-side aggregation. Financial/incentive fields are included but the
 * controller (Customer360Controller) is what actually gates them behind
 * CRM.CUSTOMER_360_VIEW — same "don't expose company financials to
 * customers/plain staff" boundary spec #31 and the Phase 6 finance module
 * already established.
 */
@Injectable()
export class Customer360Service {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        identity: {
          select: { email: true, phone: true, status: true, lastLoginAt: true },
        },
        assignedStaff: {
          select: { id: true, firstName: true, lastName: true },
        },
        assignedBranch: { select: { id: true, name: true } },
        familyMembers: true,
        documents: true,
        wallet: true,
        tagAssignments: { include: { tag: true } },
      },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async getBookings(customerId: string) {
    const [flights, hotels, visas, hajj, umrah, packages, tickets, complaints] =
      await Promise.all([
        this.prisma.flightBooking.findMany({
          where: { customerId },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.hotelBooking.findMany({
          where: { customerId },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.visaApplication.findMany({
          where: { customerId },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.hajjRegistration.findMany({
          where: { customerId },
          include: { package: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.umrahRegistration.findMany({
          where: { customerId },
          include: { package: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.travelPackage.findMany({
          where: { customerId },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.supportTicket.findMany({
          where: { customerId },
          include: { category: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.complaint.findMany({
          where: { customerId },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
    return {
      flights,
      hotels,
      visas,
      hajj,
      umrah,
      packages,
      tickets,
      complaints,
    };
  }

  async getFinancials(customerId: string) {
    const [invoices, wallet, walletBalance] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { customerId },
        include: { payments: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.wallet.findUnique({ where: { customerId } }),
      this.prisma.walletTransaction.aggregate({
        where: { wallet: { customerId }, status: 'COMPLETED' },
        _sum: { amount: true },
      }),
    ]);
    const outstandingBalance = invoices.reduce((sum, inv) => {
      const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
      return sum + Math.max(0, inv.totalAmount - paid);
    }, 0);
    return {
      invoices,
      walletId: wallet?.id ?? null,
      walletBalance: walletBalance._sum.amount ?? 0,
      outstandingBalance,
    };
  }

  timeline(customerId: string) {
    return this.prisma.customerTimelineEvent.findMany({
      where: { customerId },
      include: {
        createdByStaff: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addNote(customerId: string, note: string, staffId: string) {
    const created = await this.prisma.customerNote.create({
      data: { customerId, note, createdByStaffId: staffId },
    });
    await this.prisma.customerTimelineEvent.create({
      data: {
        customerId,
        type: 'STAFF_NOTE',
        description: note.length > 140 ? `${note.slice(0, 140)}…` : note,
        createdByStaffId: staffId,
      },
    });
    return created;
  }

  listNotes(customerId: string) {
    return this.prisma.customerNote.findMany({
      where: { customerId },
      include: {
        createdByStaff: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  listTags() {
    return this.prisma.customerTag.findMany({ orderBy: { name: 'asc' } });
  }

  async createTag(name: string) {
    return this.prisma.customerTag.create({ data: { name } });
  }

  async assignTag(customerId: string, tagId: string, staffId?: string) {
    return this.prisma.customerTagAssignment.upsert({
      where: { customerId_tagId: { customerId, tagId } },
      create: { customerId, tagId, assignedByStaffId: staffId },
      update: {},
    });
  }

  async removeTag(customerId: string, tagId: string) {
    await this.prisma.customerTagAssignment.deleteMany({
      where: { customerId, tagId },
    });
  }

  /**
   * Spec #3's fixed segment categories — computed from actual records, not
   * stored, so a segment can never drift out of sync with reality (see
   * CustomerTag's doc comment in schema.prisma).
   */
  async segments(customerId: string) {
    const [hajj, umrah, visa, flight, hotel] = await Promise.all([
      this.prisma.hajjRegistration.count({ where: { customerId } }),
      this.prisma.umrahRegistration.count({ where: { customerId } }),
      this.prisma.visaApplication.count({ where: { customerId } }),
      this.prisma.flightBooking.count({ where: { customerId } }),
      this.prisma.hotelBooking.count({ where: { customerId } }),
    ]);
    const segments: string[] = [];
    if (hajj > 0) segments.push('Hajj Customer');
    if (umrah > 0) segments.push('Umrah Customer');
    if (visa > 0) segments.push('Visa Customer');
    if (flight > 0) segments.push('Flight Customer');
    if (hotel > 0) segments.push('Hotel Customer');
    const totalBookings = hajj + umrah + visa + flight + hotel;
    segments.push(totalBookings <= 1 ? 'New Customer' : 'Returning Customer');
    return segments;
  }

  /** Spec #32 — global CRM search, gated by the caller's own permission scope in the controller. */
  async search(query: string) {
    const [customers, flights, hotels, visas, tickets] = await Promise.all([
      this.prisma.customer.findMany({
        where: {
          OR: [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { identity: { email: { contains: query, mode: 'insensitive' } } },
            { identity: { phone: { contains: query } } },
            { id: query },
          ],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          identity: { select: { email: true, phone: true } },
        },
        take: 10,
      }),
      this.prisma.flightBooking.findMany({
        where: { bookingReference: { contains: query, mode: 'insensitive' } },
        select: { id: true, bookingReference: true, customerId: true },
        take: 10,
      }),
      this.prisma.hotelBooking.findMany({
        where: { bookingReference: { contains: query, mode: 'insensitive' } },
        select: { id: true, bookingReference: true, customerId: true },
        take: 10,
      }),
      this.prisma.visaApplication.findMany({
        where: {
          applicationReference: { contains: query, mode: 'insensitive' },
        },
        select: { id: true, applicationReference: true, customerId: true },
        take: 10,
      }),
      this.prisma.supportTicket.findMany({
        where: { ticketNumber: { contains: query, mode: 'insensitive' } },
        select: { id: true, ticketNumber: true, customerId: true },
        take: 10,
      }),
    ]);
    return { customers, flights, hotels, visas, tickets };
  }
}
