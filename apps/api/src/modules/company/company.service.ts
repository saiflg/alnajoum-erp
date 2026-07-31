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
