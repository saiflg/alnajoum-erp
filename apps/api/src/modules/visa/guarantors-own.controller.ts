import {
  Body,
  Controller,
  ForbiddenException,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateGuarantorDto } from './dto/create-guarantor.dto';
import { GuarantorsService } from './guarantors.service';

/** Customer self-service: attach a guarantor to their own visa application. */
@Controller('visa/applications/me/:applicationId/guarantor')
export class GuarantorsOwnController {
  constructor(
    private readonly guarantorsService: GuarantorsService,
    private readonly customersService: CustomersService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  async attach(
    @CurrentUser() user: AuthContext,
    @Param('applicationId') applicationId: string,
    @Body() dto: CreateGuarantorDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    const application = await this.prisma.visaApplication.findUnique({
      where: { id: applicationId },
      select: { customerId: true },
    });
    if (!application || application.customerId !== customerId) {
      throw new ForbiddenException(
        'This application does not belong to this customer',
      );
    }
    return this.guarantorsService.attachToApplication(applicationId, dto);
  }
}
