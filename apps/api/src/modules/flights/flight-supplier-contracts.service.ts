import { Injectable, NotFoundException } from '@nestjs/common';
import { FlightSupplierContractStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateFlightSupplierContractDto } from './dto/create-flight-supplier-contract.dto';
import { UpdateFlightSupplierContractDto } from './dto/update-flight-supplier-contract.dto';

/** Spec #24 — "alert before contract expiry." A window, not a single day,
 * so an admin dashboard can surface "expiring soon" ahead of the deadline. */
const EXPIRY_ALERT_WINDOW_DAYS = 30;

@Injectable()
export class FlightSupplierContractsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForSupplier(supplierId: string) {
    return this.prisma.flightSupplierContract.findMany({
      where: { supplierId },
      orderBy: { startDate: 'desc' },
    });
  }

  async create(supplierId: string, dto: CreateFlightSupplierContractDto) {
    const supplier = await this.prisma.flightSupplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) throw new NotFoundException('Flight supplier not found');

    return this.prisma.flightSupplierContract.create({
      data: {
        supplierId,
        name: dto.name,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        commissionPercent: dto.commissionPercent,
        markupPercent: dto.markupPercent,
        currency: dto.currency,
        settlementTerms: dto.settlementTerms,
        ticketingTerms: dto.ticketingTerms,
        cancellationRules: dto.cancellationRules,
        contactPerson: dto.contactPerson,
        documentUrl: dto.documentUrl,
      },
    });
  }

  private async get(id: string) {
    const contract = await this.prisma.flightSupplierContract.findUnique({
      where: { id },
    });
    if (!contract) throw new NotFoundException('Supplier contract not found');
    return contract;
  }

  async update(id: string, dto: UpdateFlightSupplierContractDto) {
    await this.get(id);
    return this.prisma.flightSupplierContract.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
  }

  /** Contracts ending within the alert window and not already marked EXPIRED/TERMINATED. */
  async listExpiringSoon() {
    const cutoff = new Date(
      Date.now() + EXPIRY_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    return this.prisma.flightSupplierContract.findMany({
      where: {
        endDate: { lte: cutoff, not: null },
        status: {
          notIn: [
            FlightSupplierContractStatus.EXPIRED,
            FlightSupplierContractStatus.TERMINATED,
          ],
        },
      },
      include: { supplier: { select: { name: true } } },
      orderBy: { endDate: 'asc' },
    });
  }
}
