import { Injectable } from '@nestjs/common';
import { CustomersService } from '../customers/customers.service';
import { FlightsService } from '../flights/flights.service';
import { InvoicesService } from '../payments/invoices.service';
import { toCsv } from './csv.util';

export interface CsvExport {
  content: string;
  filename: string;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Phase 11's "data export" — one of the four spec items this codebase
 * never built at all (unlike most gaps this phase, which were built but
 * unwired). Deliberately per-entity rather than one generic exporter:
 * each entity's useful columns are genuinely different, and a "generic"
 * exporter would just be this same per-type mapping hidden behind an
 * extra layer. Reuses each module's own tenant-scoped listAll/findAll
 * (CustomersService/FlightsService/InvoicesService) rather than
 * re-querying Prisma directly, so a future tenant-isolation fix to any
 * of those only has to happen once.
 */
@Injectable()
export class DataExportService {
  constructor(
    private readonly customersService: CustomersService,
    private readonly flightsService: FlightsService,
    private readonly invoicesService: InvoicesService,
  ) {}

  async exportCustomers(tenantCompanyId?: string): Promise<CsvExport> {
    const customers = await this.customersService.findAll({}, tenantCompanyId);
    const headers = [
      'ID',
      'First Name',
      'Last Name',
      'Email',
      'Phone',
      'Status',
      'Assigned Staff',
      'Assigned Branch',
      'Created At',
    ];
    const rows = customers.map((c) => [
      c.id,
      c.firstName,
      c.lastName,
      c.identity.email,
      c.identity.phone ?? '',
      c.identity.status,
      c.assignedStaff
        ? `${c.assignedStaff.firstName} ${c.assignedStaff.lastName}`
        : '',
      c.assignedBranch?.name ?? '',
      c.createdAt.toISOString(),
    ]);
    return {
      content: toCsv(headers, rows),
      filename: `customers-${timestamp()}.csv`,
    };
  }

  async exportInvoices(tenantCompanyId?: string): Promise<CsvExport> {
    const invoices = await this.invoicesService.listAll({}, tenantCompanyId);
    const headers = [
      'Invoice Number',
      'Customer',
      'Status',
      'Currency',
      'Total Amount',
      'Amount Paid',
      'Created At',
    ];
    const rows = invoices.map((inv) => [
      inv.invoiceNumber,
      inv.customer ? `${inv.customer.firstName} ${inv.customer.lastName}` : '',
      inv.status,
      inv.currency,
      String(inv.totalAmount),
      String(inv.payments.reduce((sum, p) => sum + p.amount, 0)),
      inv.createdAt.toISOString(),
    ]);
    return {
      content: toCsv(headers, rows),
      filename: `invoices-${timestamp()}.csv`,
    };
  }

  async exportFlightBookings(tenantCompanyId?: string): Promise<CsvExport> {
    const bookings = await this.flightsService.listAll({}, tenantCompanyId);
    const headers = [
      'Booking Reference',
      'Customer',
      'Status',
      'Origin',
      'Destination',
      'Departure At',
      'Currency',
      'Total Amount',
      'Created At',
    ];
    const rows = bookings.map((b) => [
      b.bookingReference,
      `${b.customer.firstName} ${b.customer.lastName}`,
      b.status,
      b.origin,
      b.destination,
      b.departureAt.toISOString(),
      b.currency,
      String(b.totalAmount),
      b.createdAt.toISOString(),
    ]);
    return {
      content: toCsv(headers, rows),
      filename: `flight-bookings-${timestamp()}.csv`,
    };
  }
}
