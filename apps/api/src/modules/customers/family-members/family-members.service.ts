import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { UpdateFamilyMemberDto } from './dto/update-family-member.dto';

@Injectable()
export class FamilyMembersService {
  constructor(private readonly prisma: PrismaService) {}

  create(customerId: string, dto: CreateFamilyMemberDto) {
    return this.prisma.familyMember.create({
      data: {
        customerId,
        ...dto,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        passportExpiryDate: dto.passportExpiryDate
          ? new Date(dto.passportExpiryDate)
          : undefined,
      },
    });
  }

  listForCustomer(customerId: string) {
    return this.prisma.familyMember.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Fetches a family member, optionally enforcing that it belongs to `ownerCustomerId`. */
  async getMember(memberId: string, ownerCustomerId?: string) {
    const member = await this.prisma.familyMember.findUnique({
      where: { id: memberId },
      include: { documents: true },
    });
    if (!member) {
      throw new NotFoundException('Family member not found');
    }
    if (ownerCustomerId && member.customerId !== ownerCustomerId) {
      throw new ForbiddenException('This family member does not belong to you');
    }
    return member;
  }

  async update(
    memberId: string,
    dto: UpdateFamilyMemberDto,
    ownerCustomerId?: string,
  ) {
    await this.getMember(memberId, ownerCustomerId);
    return this.prisma.familyMember.update({
      where: { id: memberId },
      data: {
        ...dto,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        passportExpiryDate: dto.passportExpiryDate
          ? new Date(dto.passportExpiryDate)
          : undefined,
      },
    });
  }

  async remove(memberId: string, ownerCustomerId?: string) {
    await this.getMember(memberId, ownerCustomerId);
    await this.prisma.familyMember.delete({ where: { id: memberId } });
  }
}
