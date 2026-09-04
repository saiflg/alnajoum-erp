import { Injectable, NotFoundException } from '@nestjs/common';
import { PilgrimType } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ReadinessService } from './readiness.service';

interface ManifestRow {
  name: string;
  passportNumber: string;
  pilgrimCode: string | null;
  roomNumber: string | null;
  readiness: string;
}

/**
 * Spec #17/#18/#20 — group/flight/hotel manifest generation, PDF and CSV
 * (Excel-openable) export. Deliberately reuses ReceiptsService's pdfkit
 * pattern (a streamed PDFDocument piped straight into the HTTP response,
 * no intermediate file) rather than a second PDF pipeline, and CSV instead
 * of adding a new xlsx dependency — Excel opens CSV natively.
 *
 * Contains passport numbers, so every route this backs is gated behind
 * HAJJ_OPS.MANIFEST_VIEW at the controller.
 */
@Injectable()
export class ManifestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readinessService: ReadinessService,
  ) {}

  private async buildRows(
    groupType: PilgrimType,
    groupId: string,
  ): Promise<{ groupNumber: string; groupName: string; rows: ManifestRow[] }> {
    const group =
      groupType === PilgrimType.HAJJ
        ? await this.prisma.hajjGroup.findUnique({
            where: { id: groupId },
            include: {
              pilgrims: true,
              roomAllocations: { include: { occupants: true } },
            },
          })
        : await this.prisma.umrahGroup.findUnique({
            where: { id: groupId },
            include: {
              pilgrims: true,
              roomAllocations: { include: { occupants: true } },
            },
          });
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const roomByPilgrim = new Map<string, string>();
    for (const room of group.roomAllocations) {
      for (const occupant of room.occupants) {
        roomByPilgrim.set(occupant.pilgrimId, room.roomNumber);
      }
    }

    const rows: ManifestRow[] = [];
    for (const pilgrim of group.pilgrims) {
      const readiness = await this.readinessService.compute(
        groupType,
        pilgrim.id,
      );
      rows.push({
        name: `${pilgrim.firstName} ${pilgrim.lastName}`,
        passportNumber: pilgrim.passportNumber ?? '—',
        pilgrimCode: pilgrim.pilgrimCode,
        roomNumber: roomByPilgrim.get(pilgrim.id) ?? null,
        readiness: readiness.finalStatus,
      });
    }

    return { groupNumber: group.groupNumber, groupName: group.name, rows };
  }

  async renderPdf(groupType: PilgrimType, groupId: string) {
    const { groupNumber, groupName, rows } = await this.buildRows(
      groupType,
      groupId,
    );

    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      layout: 'landscape',
    });

    doc
      .fontSize(16)
      .fillColor('#0f172a')
      .text('Alnajoum Travel Agency — Group Manifest')
      .fontSize(11)
      .fillColor('#475569')
      .text(`${groupName} (${groupNumber})`)
      .moveDown(1);

    const colX = [40, 260, 420, 560, 680];
    const headerY = doc.y;
    doc.fontSize(9).fillColor('#0f172a');
    doc.text('Name', colX[0], headerY, { width: 200 });
    doc.text('Passport Number', colX[1], headerY, { width: 140 });
    doc.text('QR Code', colX[2], headerY, { width: 120 });
    doc.text('Room', colX[3], headerY, { width: 100 });
    doc.text('Readiness', colX[4], headerY, { width: 100 });
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(760, doc.y).strokeColor('#e2e8f0').stroke();
    doc.moveDown(0.3);

    doc.fontSize(9).fillColor('#334155');
    for (const row of rows) {
      const y = doc.y;
      doc.text(row.name, colX[0], y, { width: 200 });
      doc.text(row.passportNumber, colX[1], y, { width: 140 });
      doc.text(row.pilgrimCode ?? 'Not generated', colX[2], y, { width: 120 });
      doc.text(row.roomNumber ?? 'Unassigned', colX[3], y, { width: 100 });
      doc.text(row.readiness, colX[4], y, { width: 100 });
      doc.moveDown(0.6);
    }

    doc
      .moveDown(1)
      .fontSize(8)
      .fillColor('#94a3b8')
      .text(
        `Generated ${new Date().toISOString().slice(0, 10)} — ${rows.length} pilgrim(s). Internal use only.`,
      );

    doc.end();
    return { stream: doc, filename: `manifest-${groupNumber}.pdf` };
  }

  async renderCsv(groupType: PilgrimType, groupId: string) {
    const { groupNumber, rows } = await this.buildRows(groupType, groupId);

    const escape = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

    const lines = [
      ['Name', 'Passport Number', 'QR Code', 'Room', 'Readiness'].join(','),
      ...rows.map((r) =>
        [
          r.name,
          r.passportNumber,
          r.pilgrimCode ?? 'Not generated',
          r.roomNumber ?? 'Unassigned',
          r.readiness,
        ]
          .map(escape)
          .join(','),
      ),
    ];

    return {
      content: lines.join('\n'),
      filename: `manifest-${groupNumber}.csv`,
    };
  }
}
