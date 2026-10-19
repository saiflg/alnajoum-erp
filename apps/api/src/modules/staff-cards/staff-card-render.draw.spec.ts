/**
 * Smoke test for the card drawing: both sides render to a valid PDF with and without a logo and photograph, with
 * light and dark company colours. Set CARD_PDF_OUT_DIR to also write the PDFs out, to look at a design change.
 * Sample data only (invented person, generated logo and photo, a QR code for a made-up address).
 */
import * as fs from 'fs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import sharp from 'sharp';
import {
  Assets,
  CARD_W,
  CardData,
  drawBack,
  drawFront,
} from './staff-card-render.service';

async function renderSample(
  opts: {
    out?: string;
    primary?: string;
    accent?: string;
    noLogo?: boolean;
    noPhoto?: boolean;
  } = {},
): Promise<Buffer> {
  const primary = opts.primary ?? '#800000';
  const accent = opts.accent ?? '#ADD8E6';
  const noLogo = !!opts.noLogo;
  const noPhoto = !!opts.noPhoto;

  const logo = await sharp({
    create: {
      width: 240,
      height: 240,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><circle cx="120" cy="120" r="110" fill="#b8860b"/><path d="M120 40 L145 100 L210 105 L160 148 L176 212 L120 176 L64 212 L80 148 L30 105 L95 100 Z" fill="#fff"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  const photo = await sharp({
    create: {
      width: 300,
      height: 380,
      channels: 3,
      background: { r: 120, g: 150, b: 180 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="380"><circle cx="150" cy="140" r="70" fill="#e8c9a8"/><path d="M40 380 Q150 200 260 380 Z" fill="#26364a"/></svg>',
        ),
      },
    ])
    .jpeg()
    .toBuffer();
  const qr = await QRCode.toBuffer(
    'https://example.test/verify/card/SAMPLE-TOKEN-NOT-REAL',
    { margin: 1, width: 360, errorCorrectionLevel: 'M' },
  );

  const data: CardData = {
    cardNumber: 'ALN-C-SAMP-LE00',
    verifyUrl: 'https://example.test/verify/card/SAMPLE',
    issuedAt: new Date('2026-01-15'),
    expiresAt: new Date('2027-01-15'),
    fullName: 'Amina Yusuf',
    employeeCode: 'EMP-0042',
    jobTitle: 'Senior Travel Consultant',
    department: 'Sales',
    branchName: 'Head Office',
    companyName: 'Alnajoum Travel Agency',
    qr,
    photo: noPhoto ? null : photo,
  };
  const assets = {
    logo: noLogo ? null : logo,
    signature: null,
    settings: {
      displayName: 'Alnajoum Travel Agency',
      tagline: null,
      primaryColor: primary,
      accentColor: accent,
      contactPhone: '08141906416',
      contactEmail: 'alnajoumtravelagency@gmail.com',
      website: 'www.alnajoumtravelagency.com',
      contactAddress: 'No 15 Kankia Street U/Sarki Kaduna',
      emergencyContact: null,
      officialRegistrationLine: null,
      signatoryName: 'Samsu Yusuf',
      signatoryTitle: 'CEO',
      lostCardNotice:
        'If this card is lost or stolen, report it to your branch manager or the office immediately so it can be deactivated.',
    },
  } as unknown as Assets;

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));
  const x0 = (595.28 - (2 * CARD_W + 14)) / 2;
  for (const [i, draw] of [drawFront, drawBack].entries()) {
    doc.save();
    doc.translate(x0 + i * (CARD_W + 14), 60);
    draw(doc, data, assets);
    doc.restore();
  }
  doc.end();
  await done;
  const pdf = Buffer.concat(chunks);
  if (opts.out) fs.writeFileSync(opts.out, pdf);
  return pdf;
}

describe('card drawing', () => {
  const dir = process.env.CARD_PDF_OUT_DIR;
  const out = (name: string) => (dir ? `${dir}/${name}.pdf` : undefined);
  const variants: [string, Parameters<typeof renderSample>[0]][] = [
    ['default', {}],
    ['no-logo', { noLogo: true }],
    ['no-photo', { noPhoto: true }],
    ['light-colours', { primary: '#fde68a', accent: '#fef3c7' }],
    ['dark-colours', { primary: '#0f172a', accent: '#f59e0b' }],
  ];
  it.each(variants)(
    'draws front and back: %s',
    async (name, opts) => {
      const pdf = await renderSample({ ...opts, out: out(name) });
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(2000);
    },
    30000,
  );
});
