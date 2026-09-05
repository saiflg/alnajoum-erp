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
  flightReference: string | null;
  hotelReference: string | null;
  readiness: string;
}

/**
 * Spec #17/#18/#20 — group/flight/hotel manifest generation, PDF and CSV
 * (Excel-openable) export. Deliberately reuses ReceiptsService's pdfkit
 * pattern (a streamed PDFDocument piped straight into the HTTP response,
 * no intermediate file) rather than a second PDF pipeline, and CSV instead
 * of adding a new xlsx dependency — Excel opens CSV natively.
 *
 * The flight/hotel booking reference columns are resolved the same way
 * ReadinessService checks flightAssigned/hotelAssigned — by matching each
 * pilgrim's customerId/familyMemberId against FlightBookingPassenger/
 * HotelBookingGuest — rather than a separate "flight manifest" or "hotel
 * manifest" subsystem; a group's manifest already carries everything an
 * ops or hotel-front-desk read needs in one export.
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
              roomAllocations: {
                include: { occupants: true, hotelBooking: true },
              },
            },
          })
        : await this.prisma.umrahGroup.findUnique({
            where: { id: groupId },
            include: {
              pilgrims: true,
              roomAllocations: {
                include: { occupants: true, hotelBooking: true },
              },
            },
          });
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const roomByPilgrim = new Map<string, string>();
    // Deeper hotel-catalog integration: when the pilgrim's actual assigned
    // room is linked to a real HotelBooking, that's a more specific fact
    // than "some hotel booking exists for this customer" — it wins over the
    // generic HotelBookingGuest match below.
    const roomHotelReferenceByPilgrim = new Map<string, string>();
    for (const room of group.roomAllocations) {
      for (const occupant of room.occupants) {
        roomByPilgrim.set(occupant.pilgrimId, room.roomNumber);
        if (room.hotelBooking) {
          roomHotelReferenceByPilgrim.set(
            occupant.pilgrimId,
            `${room.hotelBooking.bookingReference} (${room.hotelBooking.hotelName})`,
          );
        }
      }
    }

    const rows: ManifestRow[] = [];
    for (const pilgrim of group.pilgrims) {
      const [readiness, flightPassenger, hotelGuest] = await Promise.all([
        this.readinessService.compute(groupType, pilgrim.id),
        this.prisma.flightBookingPassenger.findFirst({
          where: pilgrim.customerId
            ? { customerId: pilgrim.customerId }
            : { familyMemberId: pilgrim.familyMemberId! },
          orderBy: { id: 'desc' },
          select: { booking: { select: { bookingReference: true } } },
        }),
        this.prisma.hotelBookingGuest.findFirst({
          where: pilgrim.customerId
            ? { customerId: pilgrim.customerId }
            : { familyMemberId: pilgrim.familyMemberId! },
          orderBy: { id: 'desc' },
          select: {
            booking: { select: { bookingReference: true, hotelName: true } },
          },
        }),
      ]);
      const genericHotelReference = hotelGuest
        ? `${hotelGuest.booking.bookingReference} (${hotelGuest.booking.hotelName})`
        : null;
      rows.push({
        name: `${pilgrim.firstName} ${pilgrim.lastName}`,
        passportNumber: pilgrim.passportNumber ?? '—',
        pilgrimCode: pilgrim.pilgrimCode,
        roomNumber: roomByPilgrim.get(pilgrim.id) ?? null,
        flightReference: flightPassenger?.booking.bookingReference ?? null,
        hotelReference:
          roomHotelReferenceByPilgrim.get(pilgrim.id) ?? genericHotelReference,
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
      margin: 36,
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

    const colX = [36, 220, 350, 460, 560, 670];
    const headerY = doc.y;
    doc.fontSize(8).fillColor('#0f172a');
    doc.text('Name', colX[0], headerY, { width: 180 });
    doc.text('Passport', colX[1], headerY, { width: 125 });
    doc.text('QR Code', colX[2], headerY, { width: 105 });
    doc.text('Room', colX[3], headerY, { width: 95 });
    doc.text('Flight Ref', colX[4], headerY, { width: 105 });
    doc.text('Hotel Ref', colX[5], headerY, { width: 130 });
    doc.moveDown(0.5);
    doc.moveTo(36, doc.y).lineTo(800, doc.y).strokeColor('#e2e8f0').stroke();
    doc.moveDown(0.3);

    doc.fontSize(8).fillColor('#334155');
    for (const row of rows) {
      const y = doc.y;
      doc.text(row.name, colX[0], y, { width: 180 });
      doc.text(row.passportNumber, colX[1], y, { width: 125 });
      doc.text(row.pilgrimCode ?? 'Not generated', colX[2], y, { width: 105 });
      doc.text(row.roomNumber ?? 'Unassigned', colX[3], y, { width: 95 });
      doc.text(row.flightReference ?? '—', colX[4], y, { width: 105 });
      doc.text(row.hotelReference ?? '—', colX[5], y, { width: 130 });
      doc.moveDown(0.6);
    }

    doc
      .moveDown(1)
      .fontSize(8)
      .fillColor('#94a3b8')
      .text(
        `Also shown: readiness — ${rows.map((r) => `${r.name}: ${r.readiness}`).join(', ')}.`,
        { width: 760 },
      )
      .moveDown(0.5)
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
      [
        'Name',
        'Passport Number',
        'QR Code',
        'Room',
        'Flight Reference',
        'Hotel Reference',
        'Readiness',
      ].join(','),
      ...rows.map((r) =>
        [
          r.name,
          r.passportNumber,
          r.pilgrimCode ?? 'Not generated',
          r.roomNumber ?? 'Unassigned',
          r.flightReference ?? 'Not booked',
          r.hotelReference ?? 'Not booked',
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
