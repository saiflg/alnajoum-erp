import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

/**
 * Every method takes the caller's tenant (`undefined` = SUPER_ADMIN). A branch of another company is
 * a 404, a tenant cannot create a branch under another company, and the branch detail never carries
 * staff bank details.
 */
@Injectable()
export class BranchService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBranchDto, tenant?: string) {
    if (tenant !== undefined && dto.companyId !== tenant) {
      throw new NotFoundException('Company not found');
    }
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

  findAll(companyId?: string, tenant?: string) {
    // A tenant caller is always pinned to their own company, whatever companyId they pass.
    const scope = tenant !== undefined ? tenant : companyId;
    return this.prisma.branch.findMany({
      where: scope ? { companyId: scope } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenant?: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, ...(tenant !== undefined && { companyId: tenant }) },
      include: {
        company: true,
        staff: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            jobTitle: true,
            isActive: true,
          },
        },
      },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
    return branch;
  }

  async update(id: string, dto: UpdateBranchDto, tenant?: string) {
    await this.findOne(id, tenant);
    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  async remove(id: string, tenant?: string) {
    await this.findOne(id, tenant);
    await this.prisma.branch.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
