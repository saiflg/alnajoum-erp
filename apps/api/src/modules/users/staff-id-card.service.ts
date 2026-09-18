import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface StaffVerification {
  employeeCode: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  department: string | null;
  companyName: string;
  branchName: string | null;
  isActive: boolean;
}

const CARD_WIDTH = 243; // CR80 badge size (85.6mm x 54mm) at 72dpi
const CARD_HEIGHT = 153;

/**
 * A printable staff ID badge (PDF) with a QR code, plus the public
 * verification lookup that QR points at. The QR never encodes staff data
 * directly — only a URL to /staff-verify/:employeeCode — so a badge that's
 * later deactivated (UsersService.remove sets isActive: false) shows as
 * invalid the moment someone scans it, without needing to reissue or
 * reprint anything. Reuses the same qrcode/pdfkit dependencies already used
 * for 2FA setup (TwoFactorService) and payment receipts (ReceiptsService)
 * rather than adding new ones, and the same
 * {stream, filename}-returned-to-a-StreamableFile shape as
 * ReceiptsService.renderPaymentReceipt.
 */
@Injectable()
export class StaffIdCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private verifyUrl(employeeCode: string): string {
    const webOrigin = this.configService.get<string>(
      'PUBLIC_WEB_ORIGIN',
      'http://localhost:3000',
    );
    return `${webOrigin}/staff-verify/${encodeURIComponent(employeeCode)}`;
  }

  /** Same NotFound-not-Forbidden reasoning as UsersService.findOne — a
   * cross-tenant id must never be distinguishable from a missing one. */
  private async loadStaff(id: string, tenantCompanyId?: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id },
      include: { company: true, branch: true },
    });
    if (
      !staff ||
      (tenantCompanyId !== undefined && staff.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Staff member not found');
    }
    return staff;
  }

  async renderIdCard(id: string, tenantCompanyId?: string) {
    const staff = await this.loadStaff(id, tenantCompanyId);
    const qrPngBuffer = await QRCode.toBuffer(
      this.verifyUrl(staff.employeeCode),
      {
        margin: 1,
        width: 220,
      },
    );

    const doc = new PDFDocument({ size: [CARD_WIDTH, CARD_HEIGHT], margin: 0 });

    doc.rect(0, 0, CARD_WIDTH, CARD_HEIGHT).fill('#0f172a');
    doc.rect(0, 0, CARD_WIDTH, 32).fill('#f59e0b');
    doc
      .fillColor('#0f172a')
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('ALNAJOUM TRAVEL AGENCY', 12, 11, { width: 219 });

    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(`${staff.firstName} ${staff.lastName}`, 12, 44, { width: 145 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#cbd5e1')
      .text(staff.jobTitle ?? staff.department ?? 'Staff', 12, 63, {
        width: 145,
      })
      .text(staff.branch?.name ?? staff.company.name, 12, 77, { width: 145 });

    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#94a3b8')
      .text('EMPLOYEE ID', 12, 112, { width: 145 });
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#f8fafc')
      .text(staff.employeeCode, 12, 122, { width: 145 });

    doc.image(qrPngBuffer, 163, 44, { width: 68, height: 68 });
    doc
      .font('Helvetica')
      .fontSize(6)
      .fillColor('#64748b')
      .text('Scan to verify', 163, 114, { width: 68, align: 'center' });

    doc.end();
    return { stream: doc, filename: `staff-id-${staff.employeeCode}.pdf` };
  }

  async getVerification(employeeCode: string): Promise<StaffVerification> {
    const staff = await this.prisma.staff.findUnique({
      where: { employeeCode },
      include: { company: true, branch: true },
    });
    if (!staff) {
      throw new NotFoundException('No staff member matches this ID');
    }
    return {
      employeeCode: staff.employeeCode,
      firstName: staff.firstName,
      lastName: staff.lastName,
      jobTitle: staff.jobTitle,
      department: staff.department,
      companyName: staff.company.name,
      branchName: staff.branch?.name ?? null,
      isActive: staff.isActive,
    };
  }
}
