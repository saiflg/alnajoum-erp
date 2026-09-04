import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TicketMessageAuthorType } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CustomersService } from '../customers/customers.service';
import { AddTicketMessageDto } from './dto/add-ticket-message.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { SupportTicketsService } from './support-tickets.service';

/** Spec #10 — customer-facing ticket endpoints, no RBAC permission required (matches the CUSTOMER role's empty permission set — ownership is the check, not a permission key). */
@Controller('support/tickets/me')
export class SupportTicketsOwnController {
  constructor(
    private readonly ticketsService: SupportTicketsService,
    private readonly customersService: CustomersService,
  ) {}

  @Post()
  async create(@CurrentUser() user: AuthContext, @Body() dto: CreateTicketDto) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.ticketsService.create(customerId, dto);
  }

  @Get()
  async listAll(@CurrentUser() user: AuthContext) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.ticketsService.listForCustomer(customerId);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    return this.ticketsService.getForCustomer(id, customerId);
  }

  @Post(':id/messages')
  async addMessage(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: AddTicketMessageDto,
  ) {
    const customerId = await this.customersService.getCustomerIdForIdentity(
      user.sub,
    );
    // Ownership check first — never let a customer post into a ticket that isn't theirs.
    await this.ticketsService.getForCustomer(id, customerId);
    return this.ticketsService.addMessage(
      id,
      dto.message,
      TicketMessageAuthorType.CUSTOMER,
    );
  }
}
