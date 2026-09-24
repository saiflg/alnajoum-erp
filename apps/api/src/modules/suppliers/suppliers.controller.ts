import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { SupplierOnboardingStatus, SupplierType } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CreateSupplierContactDto } from './dto/create-supplier-contact.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { ReviewSupplierDto } from './dto/review-supplier.dto';
import { TransitionSupplierOnboardingDto } from './dto/transition-supplier-onboarding.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierOnboardingService } from './supplier-onboarding.service';
import { SuppliersService } from './suppliers.service';

/** Phase 16 — the domain-agnostic supplier management API. Tenant-scoped
 * exactly like FlightSuppliersController; a Super Admin has no single
 * tenant to attribute a new supplier to, same restriction as flight
 * suppliers. */
@Controller('suppliers')
export class SuppliersController {
  constructor(
    private readonly suppliersService: SuppliersService,
    private readonly onboardingService: SupplierOnboardingService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SUPPLIER.VIEW)
  list(
    @CurrentUser() user: AuthContext,
    @Query('type') type?: SupplierType,
    @Query('onboardingStatus') onboardingStatus?: string,
  ) {
    return this.suppliersService.list(
      { type, onboardingStatus },
      resolveTenantFilter(user),
    );
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SUPPLIER.CREATE)
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateSupplierDto) {
    const tenantCompanyId = resolveTenantFilter(user);
    if (tenantCompanyId === undefined) {
      throw new BadRequestException(
        'Super Admin has no single tenant to create a supplier for — sign in as a tenant admin instead.',
      );
    }
    return this.suppliersService.create(dto, tenantCompanyId, user.sub);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SUPPLIER.VIEW)
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.suppliersService.get(id, resolveTenantFilter(user));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SUPPLIER.EDIT)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliersService.update(
      id,
      dto,
      resolveTenantFilter(user),
      user.sub,
    );
  }

  @Patch(':id/review')
  @RequirePermissions(PERMISSIONS.SUPPLIER.EDIT)
  review(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReviewSupplierDto,
  ) {
    return this.suppliersService.review(
      id,
      dto,
      resolveTenantFilter(user),
      user.sub,
    );
  }

  @Get(':id/balance')
  @RequirePermissions(PERMISSIONS.SUPPLIER.VIEW)
  getBalance(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.suppliersService.getBalance(id, resolveTenantFilter(user));
  }

  @Post(':id/contacts')
  @RequirePermissions(PERMISSIONS.SUPPLIER.EDIT)
  addContact(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: CreateSupplierContactDto,
  ) {
    return this.suppliersService.addContact(
      id,
      dto,
      resolveTenantFilter(user),
      user.sub,
    );
  }

  @Delete(':id/contacts/:contactId')
  @RequirePermissions(PERMISSIONS.SUPPLIER.EDIT)
  removeContact(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Param('contactId') contactId: string,
  ) {
    return this.suppliersService.removeContact(
      id,
      contactId,
      resolveTenantFilter(user),
      user.sub,
    );
  }

  /**
   * Spec #3's onboarding lifecycle. Baseline permission is EDIT (routine
   * forward progress through the review stages); two specific target
   * statuses need more than that, checked here rather than via a second
   * static decorator since the required permission depends on the request
   * body:
   * - Submitting for ADMIN_APPROVAL needs SUPPLIER.APPROVE — the actual
   *   approve/reject decision itself goes through the pre-existing generic
   *   /approvals/:id/decide endpoint (APPROVAL.DECIDE), not this one; this
   *   only gates who may put a supplier forward for that decision.
   * - Moving to SUSPENDED/TERMINATED (or reactivating from SUSPENDED)
   *   needs SUPPLIER.SUSPEND — spec #47's explicit split between
   *   onboarding and suspension authority.
   */
  @Post(':id/onboarding/transition')
  @RequirePermissions(PERMISSIONS.SUPPLIER.EDIT)
  transitionOnboarding(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: TransitionSupplierOnboardingDto,
  ) {
    const needsApprove = dto.status === SupplierOnboardingStatus.ADMIN_APPROVAL;
    const suspendTargets: SupplierOnboardingStatus[] = [
      SupplierOnboardingStatus.SUSPENDED,
      SupplierOnboardingStatus.TERMINATED,
      SupplierOnboardingStatus.ACTIVE,
    ];
    const needsSuspend = suspendTargets.includes(dto.status);
    if (
      needsApprove &&
      !user.permissions.includes(PERMISSIONS.SUPPLIER.APPROVE)
    ) {
      throw new ForbiddenException(
        'Submitting a supplier for admin approval requires the supplier:approve permission',
      );
    }
    if (
      needsSuspend &&
      !user.permissions.includes(PERMISSIONS.SUPPLIER.SUSPEND)
    ) {
      throw new ForbiddenException(
        'Suspending, terminating, or reactivating a supplier requires the supplier:suspend permission',
      );
    }
    return this.onboardingService.transition(
      id,
      dto.status,
      resolveTenantFilter(user),
      user.sub,
      dto.reason,
    );
  }
}
