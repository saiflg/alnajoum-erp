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

export interface CardData {
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

export interface Assets {
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

/** Cuts `text` with an ellipsis so it fits `maxW` at the current font, so a long value never wraps into its neighbours. */
function clipText(doc: PDFKit.PDFDocument, text: string, maxW: number): string {
  if (doc.widthOfString(text) <= maxW) return text;
  let t = text;
  while (t.length > 1 && doc.widthOfString(`${t}…`) > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Colour helpers: the card's look follows the two colours the company chose, so shades are derived, never fixed. */
const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((x) => x + x)
          .join('')
      : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0) as [
    number,
    number,
    number,
  ];
};
const toHex = (c: number[]): string =>
  '#' +
  c
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
const mix = (a: string, b: string, t: number): string => {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};
const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** The company colour as ink on white: darkened when it is too pale to read. */
const inkOnWhite = (hex: string): string =>
  luminance(hex) > 0.35 ? mix(hex, '#000000', 0.6) : hex;
/** Readable text colour on top of a background colour. */
const onColor = (bg: string): string =>
  luminance(bg) > 0.4 ? '#0f172a' : '#ffffff';

/**
 * A faint copy of the company logo behind everything else. Drawn at a low strength so the text, photograph and QR
 * code on top stay easy to read and to scan. A logo that cannot be drawn is simply left out.
 */
function drawWatermark(
  doc: PDFKit.PDFDocument,
  a: Assets,
  cx: number,
  cy: number,
  size: number,
  opacity = 0.07,
): void {
  if (!a.logo) return;
  doc.save();
  try {
    doc.opacity(opacity);
    doc.image(a.logo, cx - size / 2, cy - size / 2, {
      fit: [size, size],
      align: 'center',
      valign: 'center',
    });
  } catch {
    /* a logo that cannot be drawn is left out */
  }
  doc.restore();
}

/** A soft drop shadow under a rounded rectangle. */
function shadow(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  doc.save();
  doc.fillOpacity(0.22);
  doc.roundedRect(x + 0.8, y + 1.6, w, h, r).fill('#000000');
  doc.restore();
}

/** The company logo on a small white disc ringed in the accent colour, for use on a coloured band. */
function logoDisc(
  doc: PDFKit.PDFDocument,
  a: Assets,
  cx: number,
  cy: number,
  r: number,
): boolean {
  if (!a.logo) return false;
  doc.save();
  try {
    doc.circle(cx, cy, r + 1.4).fill(a.settings.accentColor);
    doc.circle(cx, cy, r).fill('#ffffff');
    doc.circle(cx, cy, r - 0.5).clip();
    doc.image(a.logo, cx - (r - 2), cy - (r - 2), {
      fit: [(r - 2) * 2, (r - 2) * 2],
      align: 'center',
      valign: 'center',
    });
    doc.restore();
    return true;
  } catch {
    doc.restore();
    return false;
  }
}

/**
 * Draws one side of a card in a local coordinate system (0,0 is the card's top-left corner), so the same code
 * serves a single-card PDF page and a cell on an A4 sheet.
 *
 * Front: a gradient side panel with the photograph and staff number, a slanted accent stripe, the company name, the
 * holder's name with the job title as a pill, department and branch, dates, and the QR code on a white tile. The
 * company logo also sits faintly behind the details.
 */
export function drawFront(
  doc: PDFKit.PDFDocument,
  c: CardData,
  a: Assets,
): void {
  const { settings: s } = a;
  const dark = mix(s.primaryColor, '#000000', 0.45);
  const onP = onColor(s.primaryColor);
  const onA = onColor(s.accentColor);
  doc.save();
  doc.rect(0, 0, CARD_W, CARD_H).clip();
  doc.rect(0, 0, CARD_W, CARD_H).fill('#ffffff');

  // soft decoration on the white side
  doc.save();
  doc.fillOpacity(0.07);
  doc.circle(238, -4, 56).fill(s.primaryColor);
  doc.circle(206, 156, 44).fill(s.accentColor);
  doc.restore();
  drawWatermark(doc, a, 170, 88, 96, 0.07);

  // side panel with a slanted edge, and the accent stripe beside it
  const g = doc.linearGradient(0, 0, 60, CARD_H);
  g.stop(0, s.primaryColor).stop(1, dark);
  doc.polygon([0, 0], [98, 0], [78, CARD_H], [0, CARD_H]).fill(g);
  doc
    .polygon([98, 0], [104, 0], [84, CARD_H], [78, CARD_H])
    .fill(s.accentColor);
  doc.save();
  doc.fillOpacity(0.09);
  doc.circle(8, 150, 48).fill('#ffffff');
  doc.circle(64, -6, 30).fill('#ffffff');
  doc.restore();

  // photograph in a white frame with a shadow
  const px = 14;
  const py = 18;
  const pw = 52;
  const ph = 66;
  shadow(doc, px - 2, py - 2, pw + 4, ph + 4, 7);
  doc.roundedRect(px - 2, py - 2, pw + 4, ph + 4, 7).fill('#ffffff');
  doc.save();
  doc.roundedRect(px, py, pw, ph, 5.5).clip();
  doc.rect(px, py, pw, ph).fill('#e2e8f0');
  let drewPhoto = false;
  if (c.photo) {
    try {
      doc.image(c.photo, px, py, {
        cover: [pw, ph],
        align: 'center',
        valign: 'center',
      });
      drewPhoto = true;
    } catch {
      /* fall through to the initials placeholder */
    }
  }
  if (!drewPhoto) {
    doc
      .fillColor('#64748b')
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(initials(c.fullName), px, py + ph / 2 - 12, {
        width: pw,
        align: 'center',
      });
  }
  doc.restore();

  // staff number and card number on the panel
  doc.save();
  doc.opacity(0.75);
  doc.font('Helvetica').fontSize(5).fillColor(onP);
  doc.text('STAFF ID', 14, 94, { lineBreak: false });
  doc.text('CARD NO.', 14, 120, { lineBreak: false });
  doc.restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor(onP)
    .text(clipText(doc, c.employeeCode, 66), 14, 101, { lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(6.2)
    .fillColor(onP)
    .text(clipText(doc, c.cardNumber, 64), 14, 127, { lineBreak: false });

  // company header
  let hx = 113;
  if (logoDisc(doc, a, 125, 21, 11)) hx = 141;
  // The company name shrinks (down to a floor) to fit on one line before it is clipped.
  const title = s.displayName.toUpperCase();
  let titleSize = 8.2;
  doc.font('Helvetica-Bold');
  while (
    titleSize > 5.8 &&
    doc.fontSize(titleSize).widthOfString(title) > 233 - hx
  )
    titleSize -= 0.3;
  doc
    .font('Helvetica-Bold')
    .fontSize(titleSize)
    .fillColor(inkOnWhite(s.primaryColor))
    .text(clipText(doc, title, 233 - hx), hx, s.tagline ? 12 : 17, {
      lineBreak: false,
    });
  if (s.tagline)
    doc
      .font('Helvetica')
      .fontSize(5.4)
      .fillColor('#64748b')
      .text(clipText(doc, s.tagline, 233 - hx), hx, 23, { lineBreak: false });
  doc
    .moveTo(113, 38)
    .lineTo(233, 38)
    .lineWidth(0.5)
    .stroke(mix(s.accentColor, '#ffffff', 0.35));
  doc
    .moveTo(113, 38)
    .lineTo(137, 38)
    .lineWidth(1.8)
    .stroke(inkOnWhite(s.primaryColor));

  // identity
  doc.font('Helvetica-Bold').fontSize(12.5).fillColor('#0f172a');
  const nameH = Math.min(doc.heightOfString(c.fullName, { width: 120 }), 30);
  doc.text(c.fullName, 113, 44, { width: 120, height: 30, ellipsis: true });
  let y = 44 + nameH + 3;
  if (c.jobTitle) {
    doc.font('Helvetica-Bold').fontSize(6.2);
    const w = Math.min(doc.widthOfString(c.jobTitle) + 14, 120);
    doc.roundedRect(113, y, w, 10, 5).fill(s.accentColor);
    doc.fillColor(onA).text(clipText(doc, c.jobTitle, w - 12), 119, y + 2.7, {
      lineBreak: false,
    });
    y += 15;
  }
  doc.font('Helvetica').fontSize(6.8);
  for (const l of [c.department, c.branchName].filter(
    (v): v is string => !!v,
  )) {
    doc.circle(115, y + 3.4, 1.3).fill(s.primaryColor);
    doc
      .fillColor('#334155')
      .text(clipText(doc, l, 64), 120, y, { lineBreak: false });
    y += 9.5;
  }

  // dates
  doc.font('Helvetica').fontSize(5).fillColor('#64748b');
  doc.text('ISSUED', 113, 136, { lineBreak: false });
  doc.text('EXPIRES', 154, 136, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(6.4).fillColor('#0f172a');
  doc.text(fmtDate(c.issuedAt), 113, 142.5, { lineBreak: false });
  doc.text(fmtDate(c.expiresAt), 154, 142.5, { lineBreak: false });

  // QR code on a white tile
  shadow(doc, 186, 88, 48, 48, 5);
  doc
    .roundedRect(186, 88, 48, 48, 5)
    .lineWidth(0.8)
    .fillAndStroke('#ffffff', s.accentColor);
  doc.image(c.qr, 189, 91, { width: 42, height: 42 });
  doc
    .font('Helvetica')
    .fontSize(4.8)
    .fillColor('#64748b')
    .text('Scan to verify', 186, 138.5, { width: 48, align: 'center' });

  // base bar
  const bar = doc.linearGradient(0, 0, CARD_W, 0);
  bar.stop(0, dark).stop(0.5, s.primaryColor).stop(1, s.accentColor);
  doc.rect(0, CARD_H - 3.5, CARD_W, 3.5).fill(bar);
  doc.restore();
}

/**
 * Back: a gradient band with a slanted edge carrying the company name, the terms and contact lines, the QR code on a
 * white tile, the authorised signature, and the faint logo behind it all.
 */
export function drawBack(
  doc: PDFKit.PDFDocument,
  c: CardData,
  a: Assets,
): void {
  const { settings: s } = a;
  const dark = mix(s.primaryColor, '#000000', 0.45);
  const onP = onColor(s.primaryColor);
  doc.save();
  doc.rect(0, 0, CARD_W, CARD_H).clip();
  doc.rect(0, 0, CARD_W, CARD_H).fill('#ffffff');
  doc.save();
  doc.fillOpacity(0.07);
  doc.circle(-6, 150, 46).fill(s.accentColor);
  doc.circle(240, 130, 40).fill(s.primaryColor);
  doc.restore();
  drawWatermark(doc, a, 121, 92, 104, 0.07);

  // header band, cut on the slant
  const g = doc.linearGradient(0, 0, CARD_W, 0);
  g.stop(0, s.primaryColor).stop(1, dark);
  doc.polygon([0, 0], [CARD_W, 0], [CARD_W, 18], [0, 31]).fill(g);
  doc
    .polygon([0, 31], [CARD_W, 18], [CARD_W, 21.5], [0, 34.5])
    .fill(s.accentColor);
  let hx = 12;
  if (logoDisc(doc, a, 21, 13, 8)) hx = 36;
  doc
    .font('Helvetica-Bold')
    .fontSize(7.4)
    .fillColor(onP)
    .text(
      clipText(doc, s.displayName.toUpperCase(), CARD_W - hx - 12),
      hx,
      9.5,
      { lineBreak: false },
    );

  const left = 12;
  const width = 146;
  let y = 41;
  const para = (
    text: string,
    opts: {
      bold?: boolean;
      size?: number;
      color?: string;
      gap?: number;
      bullet?: boolean;
    } = {},
  ) => {
    const x = opts.bullet ? left + 6 : left;
    const w = opts.bullet ? width - 6 : width;
    doc
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(opts.size ?? 5.7);
    if (opts.bullet) doc.circle(left + 2, y + 2.6, 1.2).fill(s.accentColor);
    doc.fillColor(opts.color ?? '#334155').text(text, x, y, { width: w });
    y += doc.heightOfString(text, { width: w }) + (opts.gap ?? 2.6);
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
  const lines: string[] = [];
  if (contact.length >= 1) lines.push(contact.slice(0, 2).join('   ·   '));
  if (contact.length >= 3) lines.push(contact.slice(2).join('   ·   '));
  for (const l of lines) para(l, { bullet: true, gap: 2 });
  if (s.emergencyContact)
    para(`Emergency: ${s.emergencyContact}`, { bold: true, bullet: true });
  if (s.officialRegistrationLine)
    para(s.officialRegistrationLine, { color: '#64748b' });

  // Signature of the person who authorises cards, only if the company has configured one
  if (s.signatoryName || a.signature) {
    const sy = 132;
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
        .text(clipText(doc, s.signatoryName, 100), left, sy + 2.6, {
          lineBreak: false,
        });
    if (s.signatoryTitle)
      doc
        .font('Helvetica')
        .fontSize(5.2)
        .fillColor('#64748b')
        .text(clipText(doc, s.signatoryTitle, 100), left, sy + 9.4, {
          lineBreak: false,
        });
  }

  // Verification block
  shadow(doc, 174, 44, 58, 58, 5);
  doc
    .roundedRect(174, 44, 58, 58, 5)
    .lineWidth(0.8)
    .fillAndStroke('#ffffff', s.accentColor);
  doc.image(c.qr, 178, 48, { width: 50, height: 50 });
  doc
    .font('Helvetica')
    .fontSize(5)
    .fillColor('#64748b')
    .text('Scan to confirm this card is genuine and still valid.', 168, 106, {
      width: 70,
      align: 'center',
    });
  doc
    .font('Helvetica-Bold')
    .fontSize(6.2)
    .fillColor(inkOnWhite(s.primaryColor))
    .text(c.cardNumber, 168, 123, { width: 70, align: 'center' });

  const bar = doc.linearGradient(0, 0, CARD_W, 0);
  bar.stop(0, s.accentColor).stop(0.5, s.primaryColor).stop(1, dark);
  doc.rect(0, CARD_H - 3.5, CARD_W, 3.5).fill(bar);
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
