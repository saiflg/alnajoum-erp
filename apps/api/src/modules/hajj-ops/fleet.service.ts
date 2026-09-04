import { Injectable, NotFoundException } from '@nestjs/common';
import { DriverStatus, VehicleFleetStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateDriverDto, CreateVehicleDto } from './dto/fleet.dto';

/** Spec #13/#14 — internal fleet for pilgrim transport (distinct from the customer-facing VehicleRental marketplace booking). */
@Injectable()
export class FleetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  createVehicle(dto: CreateVehicleDto) {
    return this.prisma.vehicle.create({ data: dto });
  }

  listVehicles(status?: VehicleFleetStatus) {
    return this.prisma.vehicle.findMany({
      where: status ? { status } : undefined,
      orderBy: { plateNumber: 'asc' },
    });
  }

  async updateVehicleStatus(id: string, status: VehicleFleetStatus) {
    await this.getVehicle(id);
    return this.prisma.vehicle.update({ where: { id }, data: { status } });
  }

  async getVehicle(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  async createDriver(dto: CreateDriverDto) {
    const driver = await this.prisma.driver.create({ data: dto });
    // licenseNumber is sensitive — record that it was set, never its value.
    await this.auditService.record({
      action: 'driver.created',
      entityType: 'Driver',
      entityId: driver.id,
    });
    return driver;
  }

  /** Non-sensitive list — no licenseNumber, matches Staff.bankAccountNumber's list/detail split. */
  listDrivers(status?: DriverStatus) {
    return this.prisma.driver.findMany({
      where: status ? { status } : undefined,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        status: true,
        vehicleId: true,
        vehicle: { select: { plateNumber: true, type: true } },
      },
      orderBy: { firstName: 'asc' },
    });
  }

  /** Full detail including licenseNumber — gated behind DRIVER_SENSITIVE_VIEW at the controller. */
  async getDriver(id: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { id },
      include: { vehicle: true },
    });
    if (!driver) throw new NotFoundException('Driver not found');
    return driver;
  }

  async updateDriverStatus(id: string, status: DriverStatus) {
    await this.getDriver(id);
    return this.prisma.driver.update({ where: { id }, data: { status } });
  }
}
