import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { WhatsAppConversationStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { resolveTenantFilter } from '../../common/utils/tenant.util';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { AssignConversationDto } from './dto/assign-conversation.dto';
import { SendPaymentLinkDto } from './dto/send-payment-link.dto';
import { SendReplyDto } from './dto/send-reply.dto';
import { SetConversationStatusDto } from './dto/set-conversation-status.dto';
import { WhatsAppAiReplySuggestionService } from './whatsapp-ai-reply-suggestion.service';
import { WhatsAppConversationsService } from './whatsapp-conversations.service';
import { WhatsAppPaymentLinkService } from './whatsapp-payment-link.service';

/** Phase 14 spec #32/#64 — the staff WhatsApp inbox API. Every method is
 * tenant-scoped through WhatsAppConversationsService exactly like every
 * other admin list/detail endpoint in this codebase. */
@Controller('whatsapp/conversations')
export class WhatsAppAdminController {
  constructor(
    private readonly conversationsService: WhatsAppConversationsService,
    private readonly usersService: UsersService,
    private readonly aiReplySuggestionService: WhatsAppAiReplySuggestionService,
    private readonly paymentLinkService: WhatsAppPaymentLinkService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WHATSAPP.READ)
  list(
    @CurrentUser() user: AuthContext,
    @Query('status') status?: WhatsAppConversationStatus,
    @Query('assignedStaffId') assignedStaffId?: string,
    @Query('branchId') branchId?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.conversationsService.list(
      { status, assignedStaffId, branchId },
      resolveTenantFilter(user),
      50,
      cursor,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.WHATSAPP.READ)
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.conversationsService.get(id, resolveTenantFilter(user));
  }

  @Get(':id/messages')
  @RequirePermissions(PERMISSIONS.WHATSAPP.READ)
  listMessages(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.conversationsService.listMessages(
      id,
      resolveTenantFilter(user),
      50,
      cursor,
    );
  }

  @Post(':id/reply')
  @RequirePermissions(PERMISSIONS.WHATSAPP.SEND)
  async reply(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: SendReplyDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.conversationsService.sendReply(
      id,
      dto.body,
      staffId ?? user.sub,
      resolveTenantFilter(user),
    );
  }

  /** Drafts a reply for staff to review/edit/send — never sends anything
   * itself. Same permission as replying, since anyone who can send a
   * reply can ask for a draft of one. */
  @Post(':id/suggest-reply')
  @RequirePermissions(PERMISSIONS.WHATSAPP.SEND)
  suggestReply(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.aiReplySuggestionService.suggestReply(id, user);
  }

  /** Sends a real payment link (a genuine PaymentIntent + checkout URL
   * from PaymentsService, same as the customer portal) for one invoice
   * belonging to this conversation's verified customer — via the normal
   * staff-reply pipeline, so it's attributed and stored like any other
   * reply. */
  @Post(':id/send-payment-link')
  @RequirePermissions(PERMISSIONS.WHATSAPP.SEND)
  async sendPaymentLink(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: SendPaymentLinkDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.paymentLinkService.sendForConversation(
      id,
      dto.invoiceId,
      staffId ?? user.sub,
      resolveTenantFilter(user),
    );
  }

  @Post(':id/notes')
  @RequirePermissions(PERMISSIONS.WHATSAPP.MANAGE)
  async addNote(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: SendReplyDto,
  ) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    return this.conversationsService.addInternalNote(
      id,
      dto.body,
      staffId ?? user.sub,
      resolveTenantFilter(user),
    );
  }

  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.WHATSAPP.CONVERSATIONS_ASSIGN)
  assign(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: AssignConversationDto,
  ) {
    return this.conversationsService.assign(
      id,
      dto.staffId,
      resolveTenantFilter(user),
    );
  }

  /** Self-assignment — the frontend only ever has the caller's identity,
   * never their Staff.id, so this resolves it server-side the same way
   * every other "act as myself" endpoint in this codebase does (e.g.
   * TasksController.create), rather than expecting the client to know
   * its own staff record. */
  @Post(':id/assign-to-me')
  @RequirePermissions(PERMISSIONS.WHATSAPP.CONVERSATIONS_ASSIGN)
  async assignToMe(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can be assigned a conversation');
    }
    return this.conversationsService.assign(
      id,
      staffId,
      resolveTenantFilter(user),
    );
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.WHATSAPP.MANAGE)
  setStatus(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: SetConversationStatusDto,
  ) {
    return this.conversationsService.setStatus(
      id,
      dto.status,
      resolveTenantFilter(user),
    );
  }

  @Post(':id/pause-automation')
  @RequirePermissions(PERMISSIONS.WHATSAPP.MANAGE)
  pauseAutomation(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.conversationsService.setAutomationPaused(
      id,
      true,
      resolveTenantFilter(user),
    );
  }

  @Post(':id/resume-automation')
  @RequirePermissions(PERMISSIONS.WHATSAPP.MANAGE)
  resumeAutomation(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.conversationsService.setAutomationPaused(
      id,
      false,
      resolveTenantFilter(user),
    );
  }
}
