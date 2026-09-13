import { Injectable } from '@nestjs/common';
import { IdentityType } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { csvRowsToRecords, parseCsv } from './csv.util';

/** Mirrors UsersService.createStaff's own private helper — a temp
 * password generator this small isn't worth a shared-util import for
 * one more call site. */
function generateTemporaryPassword(): string {
  return `Tmp${randomBytes(6).toString('hex')}!`;
}

export interface ImportRowIssue {
  row: number; // 1-based, counting the header as row 1 (matches what a spreadsheet app shows)
  email?: string;
  reason: string;
}

export interface CustomerImportResult {
  totalRows: number;
  created: number;
  skipped: number;
  issues: ImportRowIssue[];
}

/**
 * Phase 11's "data import" — scoped to customers only, deliberately: a
 * bulk-created Customer is low-risk (no financial/booking state to get
 * wrong), unlike bulk-importing bookings or invoices would be. Follows
 * the exact same identity-creation shape as UsersService.createStaff
 * (temp password, emailed once, never returned to the caller) rather
 * than AuthService.registerCustomer's self-chosen-password flow, since
 * this is staff acting on someone else's behalf, not the customer
 * themselves signing up.
 */
@Injectable()
export class DataImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  async importCustomers(
    fileContent: string,
    tenantCompanyId: string,
    importedByIdentityId: string,
  ): Promise<CustomerImportResult> {
    const records = csvRowsToRecords(parseCsv(fileContent));
    const result: CustomerImportResult = {
      totalRows: records.length,
      created: 0,
      skipped: 0,
      issues: [],
    };

    for (let i = 0; i < records.length; i++) {
      const rowNumber = i + 2; // header is row 1, so the first data row is row 2
      const record = records[i];
      const email = record['email'];
      const firstName = record['first name'] || record['firstname'];
      const lastName = record['last name'] || record['lastname'];
      const phone = record['phone'] || undefined;

      if (!email || !firstName || !lastName) {
        result.issues.push({
          row: rowNumber,
          email: email || undefined,
          reason: 'Missing required column(s): email, first name, last name',
        });
        continue;
      }

      const existing = await this.prisma.identity.findUnique({
        where: { email },
      });
      if (existing) {
        result.skipped += 1;
        result.issues.push({
          row: rowNumber,
          email,
          reason: 'An account with this email already exists — skipped',
        });
        continue;
      }

      try {
        const temporaryPassword = generateTemporaryPassword();
        const passwordHash = await argon2.hash(temporaryPassword);
        const identity = await this.prisma.identity.create({
          data: {
            email,
            phone,
            passwordHash,
            type: IdentityType.CUSTOMER,
            status: 'ACTIVE',
            customer: {
              create: { firstName, lastName, companyId: tenantCompanyId },
            },
          },
        });

        await this.notificationsService.sendGeneric(
          email,
          identity.id,
          'Your Alnajoum Travel Agency account',
          [
            `Hi ${firstName},`,
            '',
            'An account has been created for you on the Alnajoum Travel Agency platform.',
            '',
            `Temporary password: ${temporaryPassword}`,
            '',
            'Please log in and change this password as soon as possible.',
          ].join('\n'),
        );

        result.created += 1;
      } catch (error) {
        result.issues.push({
          row: rowNumber,
          email,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    await this.auditService.record({
      identityId: importedByIdentityId,
      action: 'data.customers_imported',
      entityType: 'Customer',
      companyId: tenantCompanyId,
      metadata: {
        totalRows: result.totalRows,
        created: result.created,
        skipped: result.skipped,
        issueCount: result.issues.length,
      },
    });

    return result;
  }
}
