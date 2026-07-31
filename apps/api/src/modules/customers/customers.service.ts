import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.customer.findMany({
      include: { identity: { select: { email: true, phone: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        identity: { select: { email: true, phone: true, status: true } },
        documents: true,
      },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async getCustomerIdForIdentity(identityId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { identityId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException('Customer profile not found');
    }
    return customer.id;
  }

  async findByIdentityId(identityId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { identityId },
      include: {
        identity: { select: { email: true, phone: true, status: true } },
        documents: true,
      },
    });
    if (!customer) {
      throw new NotFoundException('Customer profile not found');
    }
    return customer;
  }

  async update(id: string, dto: UpdateCustomerProfileDto) {
    await this.findOne(id);
    return this.prisma.customer.update({
      where: { id },
      data: {
        ...dto,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        passportExpiryDate: dto.passportExpiryDate
          ? new Date(dto.passportExpiryDate)
          : undefined,
      },
    });
  }

  async updateByIdentityId(identityId: string, dto: UpdateCustomerProfileDto) {
    const customer = await this.findByIdentityId(identityId);
    return this.update(customer.id, dto);
  }

  async deactivate(id: string) {
    const customer = await this.findOne(id);
    await this.prisma.identity.update({
      where: { id: customer.identityId },
      data: { status: 'DEACTIVATED' },
    });
  }
}
