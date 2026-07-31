import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBranchDto) {
    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }

    const duplicateCode = await this.prisma.branch.findUnique({
      where: { companyId_code: { companyId: dto.companyId, code: dto.code } },
    });
    if (duplicateCode) {
      throw new ConflictException(
        `Branch code "${dto.code}" already exists for this company`,
      );
    }

    return this.prisma.branch.create({ data: dto });
  }

  findAll(companyId?: string) {
    return this.prisma.branch.findMany({
      where: companyId ? { companyId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
      include: { company: true, staff: true },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
    return branch;
  }

  async update(id: string, dto: UpdateBranchDto) {
    await this.findOne(id);
    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.branch.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
