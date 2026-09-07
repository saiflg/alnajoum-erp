import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCompanyDto) {
    return this.prisma.company.create({ data: dto });
  }

  findAll() {
    return this.prisma.company.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /**
   * Phase 11 — a public/unauthenticated flow (customer self-registration,
   * a lead converting to a customer with no company context of its own)
   * has no tenant to attach the new record to on its own. This platform
   * has only ever had one Company in real use, so "the oldest active
   * one" is the correct, unsurprising default — never an arbitrary pick,
   * and never something a client can override by passing its own id.
   */
  async getDefaultCompanyId(): Promise<string> {
    const company = await this.prisma.company.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!company) {
      throw new NotFoundException(
        'No active company is configured on this platform yet.',
      );
    }
    return company.id;
  }

  async findOne(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: { branches: true },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  async update(id: string, dto: UpdateCompanyDto) {
    await this.findOne(id);
    return this.prisma.company.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.company.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
