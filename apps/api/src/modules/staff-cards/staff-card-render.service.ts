import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { StaffCardSettings } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  readCardImage,
  CARD_ASSET_NAMESPACE,
  STAFF_PHOTO_NAMESPACE,
} from './staff-card-images';
import { StaffCardSettingsService } from './staff-card-settings.service';
import { effectiveStatus } from './staff-card.policy';

// CR80 (ISO/IEC 7810 ID-1): 85.60 x 53.98 mm, in PDF points.
export const CARD_W = 242.65;
export const CARD_H = 153;

interface CardData {
  cardNumber: string;
  verifyUrl: string;
  issuedAt: Date | null;
  expiresAt: Date | null;
  fullName: string;
  employeeCode: string;
  jobTitle: string | null;
  department: string | null;
  branchName: string | null;
  companyName: string;
  qr: Buffer;
  photo: Buffer | null;
}

interface Assets {
  settings: StaffCardSettings;
  logo: Buffer | null;
  signature: Buffer | null;
}

const fmtDate = (d: Date | null): string =>
  d
    ? d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Africa/Lagos',
      })
    : '—';

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

/**
 * Draws one side of a card in a local coordinate system (0,0 is the card's top-left corner), so the same code
 * serves a single-card PDF page and a cell on an A4 sheet.
 */
function drawFront(doc: PDFKit.PDFDocument, c: CardData, a: Assets): void {
  const { settings: s } = a;
  doc.save();
  doc.rect(0, 0, CARD_W, CARD_H).clip();
  doc.rect(0, 0, CARD_W, CARD_H).fill('#ffffff');

  // Header band: logo and company name
  doc.rect(0, 0, CARD_W, 36).fill(s.primaryColor);
  doc.rect(0, 36, CARD_W, 2.5).fill(s.accentColor);
  let textX = 12;
  if (a.logo) {
    try {
      doc.image(a.logo, 9, 6, {
        fit: [26, 24],
        align: 'center',
        valign: 'center',
      });
      textX = 42;
    } catch {
      /* a logo that cannot be drawn is left out rather than breaking the card */
    }
  }
  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .text(s.displayName.toUpperCase(), textX, s.tagline ? 9 : 13, {
      width: CARD_W - textX - 8,
      lineBreak: false,
      ellipsis: true,
    });
  if (s.tagline)
    doc
      .font('Helvetica')
      .fontSize(5.6)
      .fillColor(s.accentColor)
      .text(s.tagline, textX, 22, {
        width: CARD_W - textX - 8,
        lineBreak: false,
        ellipsis: true,
      });

  // Photograph
  const px = 11;
  const py = 47;
  const pw = 58;
  const ph = 72;
  doc.rect(px, py, pw, ph).fill('#e2e8f0');
  if (c.photo) {
    try {
      doc.save();
      doc.rect(px, py, pw, ph).clip();
      doc.image(c.photo, px, py, {
        cover: [pw, ph],
        align: 'center',
        valign: 'center',
      });
      doc.restore();
    } catch {
      /* fall through to the initials placeholder */
    }
  } else {
    doc
      .fillColor('#64748b')
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(initials(c.fullName), px, py + ph / 2 - 12, {
        width: pw,
        align: 'center',
      });
  }
  doc.rect(px, py, pw, ph).lineWidth(0.8).stroke(s.accentColor);

  // Identity
  const tx = 78;
  doc
    .fillColor('#0f172a')
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(c.fullName, tx, 47, { width: 92, height: 28, ellipsis: true });
  const lines = [c.jobTitle, c.department, c.branchName].filter(
    (v): v is string => !!v,
  );
  let y = 47 + Math.min(doc.heightOfString(c.fullName, { width: 92 }), 28) + 3;
  doc.font('Helvetica').fontSize(7.2).fillColor('#334155');
  for (const l of lines.slice(0, 3)) {
    doc.text(l, tx, y, { width: 92, lineBreak: false, ellipsis: true });
    y += 9.5;
  }
  doc
    .font('Helvetica')
    .fontSize(5.4)
    .fillColor('#64748b')
    .text('STAFF ID', tx, 98, { width: 92 });
  doc
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .fillColor(s.primaryColor)
    .text(c.employeeCode, tx, 105, {
      width: 92,
      lineBreak: false,
      ellipsis: true,
    });

  // QR code
  doc.image(c.qr, 176, 47, { width: 58, height: 58 });
  doc
    .font('Helvetica')
    .fontSize(5)
    .fillColor('#64748b')
    .text('Scan to verify', 176, 107, { width: 58, align: 'center' });

  // Footer strip
  doc.rect(0, 131, CARD_W, 22).fill(s.primaryColor);
  doc.font('Helvetica').fontSize(5.6).fillColor('#cbd5e1');
  doc.text(`CARD NO.`, 11, 136, { lineBreak: false });
  doc.text(`ISSUED`, 98, 136, { lineBreak: false });
  doc.text(`EXPIRES`, 160, 136, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff');
  doc.text(c.cardNumber, 11, 143, { lineBreak: false });
  doc.text(fmtDate(c.issuedAt), 98, 143, { lineBreak: false });
  doc.text(fmtDate(c.expiresAt), 160, 143, { lineBreak: false });
  doc.restore();
}

function drawBack(doc: PDFKit.PDFDocument, c: CardData, a: Assets): void {
  const { settings: s } = a;
  doc.save();
  doc.rect(0, 0, CARD_W, CARD_H).clip();
  doc.rect(0, 0, CARD_W, CARD_H).fill('#ffffff');
  doc.rect(0, 0, CARD_W, 16).fill(s.primaryColor);
  doc.rect(0, 16, CARD_W, 2).fill(s.accentColor);
  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(7.2)
    .text(s.displayName.toUpperCase(), 10, 5, {
      width: CARD_W - 20,
      lineBreak: false,
      ellipsis: true,
    });

  const left = 10;
  const width = 148;
  let y = 25;
  const para = (
    text: string,
    opts: { bold?: boolean; size?: number; color?: string; gap?: number } = {},
  ) => {
    doc
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(opts.size ?? 5.8)
      .fillColor(opts.color ?? '#334155');
    doc.text(text, left, y, { width });
    y += doc.heightOfString(text, { width }) + (opts.gap ?? 3);
  };

  para(
    `This card is the property of ${s.displayName}. It identifies the holder as a member of staff, must be shown on request and may not be lent to anyone else.`,
  );
  para(s.lostCardNotice, { bold: true, color: '#0f172a' });
  const contact = [
    s.contactPhone,
    s.contactEmail,
    s.website,
    s.contactAddress,
  ].filter((v): v is string => !!v);
  if (contact.length) para(contact.join('   ·   '), { gap: 3 });
  if (s.emergencyContact)
    para(`Emergency: ${s.emergencyContact}`, { bold: true });
  if (s.officialRegistrationLine)
    para(s.officialRegistrationLine, { color: '#64748b' });

  // Signature of the person who authorises cards, only if the company has configured one
  if (s.signatoryName || a.signature) {
    const sy = 116;
    if (a.signature) {
      try {
        doc.image(a.signature, left, sy - 22, {
          fit: [62, 22],
          valign: 'bottom',
        });
      } catch {
        /* ignore an unreadable signature image */
      }
    }
    doc
      .moveTo(left, sy + 1)
      .lineTo(left + 66, sy + 1)
      .lineWidth(0.5)
      .stroke('#94a3b8');
    if (s.signatoryName)
      doc
        .font('Helvetica-Bold')
        .fontSize(5.6)
        .fillColor('#0f172a')
        .text(s.signatoryName, left, sy + 3, {
          width: 100,
          lineBreak: false,
          ellipsis: true,
        });
    if (s.signatoryTitle)
      doc
        .font('Helvetica')
        .fontSize(5.2)
        .fillColor('#64748b')
        .text(s.signatoryTitle, left, sy + 10, {
          width: 100,
          lineBreak: false,
          ellipsis: true,
        });
  }

  // Verification block
  doc.image(c.qr, 176, 28, { width: 56, height: 56 });
  doc
    .font('Helvetica')
    .fontSize(5)
    .fillColor('#64748b')
    .text('Scan to confirm this card is genuine and still valid.', 168, 88, {
      width: 72,
      align: 'center',
    });
  doc
    .font('Helvetica-Bold')
    .fontSize(6)
    .fillColor(s.primaryColor)
    .text(c.cardNumber, 168, 109, { width: 72, align: 'center' });
  doc.rect(0, 149, CARD_W, 4).fill(s.accentColor);
  doc.restore();
}

@Injectable()
export class StaffCardRenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: StaffCardSettingsService,
  ) {}

  verifyUrl(token: string): string {
    const origin = this.config.get<string>(
      'PUBLIC_WEB_ORIGIN',
      'http://localhost:3000',
    );
    return `${origin.replace(/\/$/, '')}/verify/card/${token}`;
  }

  private async qr(url: string): Promise<Buffer> {
    return QRCode.toBuffer(url, {
      margin: 1,
      width: 360,
      errorCorrectionLevel: 'M',
    });
  }

  private async assets(companyId: string): Promise<Assets> {
    const settings = await this.settings.get(companyId);
    return {
      settings,
      logo: await readCardImage(CARD_ASSET_NAMESPACE, settings.logoFilename),
      signature: await readCardImage(
        CARD_ASSET_NAMESPACE,
        settings.signatureFilename,
      ),
    };
  }

  private async cardData(id: string, tenant?: string) {
    const card = await this.prisma.staffIdCard.findFirst({
      where: { id, ...(tenant !== undefined && { companyId: tenant }) },
      include: {
        staff: {
          select: {
            employeeCode: true,
            firstName: true,
            lastName: true,
            jobTitle: true,
            department: true,
            isActive: true,
            photoFilename: true,
            branch: { select: { name: true } },
            company: { select: { name: true, tradingName: true } },
          },
        },
      },
    });
    if (!card) throw new BadRequestException('Identification card not found');
    const url = this.verifyUrl(card.verificationToken);
    const data: CardData = {
      cardNumber: card.cardNumber,
      verifyUrl: url,
      issuedAt: card.issuedAt,
      expiresAt: card.expiresAt,
      fullName: `${card.staff.firstName} ${card.staff.lastName}`,
      employeeCode: card.staff.employeeCode,
      jobTitle: card.staff.jobTitle,
      department: card.staff.department,
      branchName: card.staff.branch?.name ?? null,
      companyName: card.staff.company.tradingName ?? card.staff.company.name,
      qr: await this.qr(url),
      photo: await readCardImage(
        STAFF_PHOTO_NAMESPACE,
        card.staff.photoFilename,
      ),
    };
    return { card, data };
  }

  /** What the on-screen card needs: everything printed on it, the QR and the images as data URLs. */
  async preview(id: string, tenant?: string) {
    const { card, data } = await this.cardData(id, tenant);
    const a = await this.assets(card.companyId);
    const dataUrl = (b: Buffer | null, mime: string) =>
      b ? `data:${mime};base64,${b.toString('base64')}` : null;
    return {
      cardNumber: data.cardNumber,
      status: card.status,
      effectiveStatus: effectiveStatus(card, card.staff.isActive),
      fullName: data.fullName,
      employeeCode: data.employeeCode,
      jobTitle: data.jobTitle,
      department: data.department,
      branchName: data.branchName,
      issuedAt: data.issuedAt,
      expiresAt: data.expiresAt,
      verifyUrl: data.verifyUrl,
      qrDataUrl: dataUrl(data.qr, 'image/png'),
      photoDataUrl: dataUrl(data.photo, 'image/jpeg'),
      logoDataUrl: dataUrl(a.logo, 'image/png'),
      signatureDataUrl: dataUrl(a.signature, 'image/png'),
      design: {
        displayName: a.settings.displayName,
        tagline: a.settings.tagline,
        primaryColor: a.settings.primaryColor,
        accentColor: a.settings.accentColor,
        contactPhone: a.settings.contactPhone,
        contactEmail: a.settings.contactEmail,
        contactAddress: a.settings.contactAddress,
        website: a.settings.website,
        officialRegistrationLine: a.settings.officialRegistrationLine,
        emergencyContact: a.settings.emergencyContact,
        lostCardNotice: a.settings.lostCardNotice,
        signatoryName: a.settings.signatoryName,
        signatoryTitle: a.settings.signatoryTitle,
      },
    };
  }

  /**
   * A print-ready PDF. `cards`: each card is its own CR80 page, front then back (what a PVC card printer wants).
   * `sheet`: A4 pages of ten with cut guides, fronts on one page and backs on the next, columns mirrored so a
   * duplex print lines the two sides up. `both`: A4 pages with each card's front and back side by side on the same
   * page (five cards a page), for looking at, filing or printing on one side.
   */
  async render(
    ids: string[],
    layout: 'cards' | 'sheet' | 'both',
    tenant?: string,
  ): Promise<{
    stream: PDFKit.PDFDocument;
    filename: string;
    printed: string[];
  }> {
    const items: { data: CardData; a: Assets; id: string; status: string }[] =
      [];
    const assetCache = new Map<string, Assets>();
    for (const id of ids) {
      const { card, data } = await this.cardData(id, tenant);
      const eff = effectiveStatus(card, card.staff.isActive);
      // Only a card that identifies someone, or is about to, is worth printing.
      if (eff !== 'ACTIVE' && eff !== 'PENDING')
        throw new BadRequestException(
          `Card ${card.cardNumber} is ${eff.toLowerCase()} and cannot be printed.`,
        );
      let a = assetCache.get(card.companyId);
      if (!a) {
        a = await this.assets(card.companyId);
        assetCache.set(card.companyId, a);
      }
      items.push({ data, a, id, status: eff });
    }

    const doc =
      layout === 'cards'
        ? new PDFDocument({
            size: [CARD_W, CARD_H],
            margin: 0,
            autoFirstPage: false,
            info: { Title: 'Staff identification cards' },
          })
        : new PDFDocument({
            size: 'A4',
            margin: 0,
            autoFirstPage: false,
            info: {
              Title:
                layout === 'both'
                  ? 'Staff identification cards (front and back)'
                  : 'Staff identification cards (sheet)',
            },
          });

    if (layout === 'cards') {
      for (const it of items) {
        doc.addPage({ size: [CARD_W, CARD_H], margin: 0 });
        drawFront(doc, it.data, it.a);
        doc.addPage({ size: [CARD_W, CARD_H], margin: 0 });
        drawBack(doc, it.data, it.a);
      }
    } else if (layout === 'both') {
      const gutter = 12;
      const rowGap = 14;
      const pageW = 595.28;
      const pageH = 841.89;
      const rows = 5;
      const startX = (pageW - (2 * CARD_W + gutter)) / 2;
      const startY = 48;
      for (let i = 0; i < items.length; i += rows) {
        doc.addPage({ size: 'A4', margin: 0 });
        items.slice(i, i + rows).forEach((it, row) => {
          const y = startY + row * (CARD_H + rowGap);
          for (const side of ['front', 'back'] as const) {
            const x = startX + (side === 'front' ? 0 : CARD_W + gutter);
            doc.save();
            doc.translate(x, y);
            if (side === 'front') drawFront(doc, it.data, it.a);
            else drawBack(doc, it.data, it.a);
            doc.restore();
            doc.save();
            doc
              .lineWidth(0.25)
              .dash(2, { space: 2 })
              .rect(x, y, CARD_W, CARD_H)
              .stroke('#94a3b8');
            doc.restore();
          }
        });
        doc
          .font('Helvetica')
          .fontSize(6)
          .fillColor('#94a3b8')
          .text(
            'Front (left) and back (right) of each card. Cut along the dashed lines.',
            36,
            pageH - 24,
            { lineBreak: false },
          );
      }
    } else {
      const cols = 2;
      const rows = 5;
      const gutter = 8;
      const pageW = 595.28;
      const pageH = 841.89;
      const startX = (pageW - (cols * CARD_W + (cols - 1) * gutter)) / 2;
      const startY = (pageH - (rows * CARD_H + (rows - 1) * gutter)) / 2;
      const perPage = cols * rows;
      for (let i = 0; i < items.length; i += perPage) {
        const batch = items.slice(i, i + perPage);
        for (const side of ['front', 'back'] as const) {
          doc.addPage({ size: 'A4', margin: 0 });
          batch.forEach((it, idx) => {
            const row = Math.floor(idx / cols);
            const col = idx % cols;
            // Backs mirror left-to-right so that flipping the sheet on its long edge puts each back behind its front.
            const drawCol = side === 'front' ? col : cols - 1 - col;
            const x = startX + drawCol * (CARD_W + gutter);
            const y = startY + row * (CARD_H + gutter);
            doc.save();
            doc.translate(x, y);
            if (side === 'front') drawFront(doc, it.data, it.a);
            else drawBack(doc, it.data, it.a);
            doc.restore();
            // cut guide around the card
            doc.save();
            doc
              .lineWidth(0.25)
              .dash(2, { space: 2 })
              .rect(x, y, CARD_W, CARD_H)
              .stroke('#94a3b8');
            doc.restore();
          });
          doc
            .font('Helvetica')
            .fontSize(6)
            .fillColor('#94a3b8')
            .text(
              `${side === 'front' ? 'FRONTS' : 'BACKS'} - print both sides, flip on the long edge. Cut along the dashed lines.`,
              36,
              pageH - 24,
              { lineBreak: false },
            );
        }
      }
    }
    doc.end();
    const only =
      items.length === 1 ? items[0].data.cardNumber : `${items.length}-cards`;
    return {
      stream: doc,
      filename: `staff-id-${only}-${layout}.pdf`,
      printed: items.map((i) => i.id),
    };
  }
}
