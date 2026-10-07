import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import {
  DeadLetterQueryDto,
  ExecutionQueryDto,
  ReasonDto,
  ResolveDeadLetterDto,
  RetryDeadLetterDto,
} from './dto/workflow.dto';
import { WorkflowsService } from './workflows.service';

/**
 * The automation control centre: what is running, what failed, and the human controls
 * (retry, cancel, resolve). Kept apart from /workflows so a `:id` route can never shadow
 * one of these fixed paths.
 */
@Controller('automation')
export class AutomationController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get('catalog')
  @RequirePermissions(PERMISSIONS.WORKFLOW.VIEW)
  catalog() {
    return this.workflows.catalog();
  }

  @Get('metrics')
  @RequirePermissions(PERMISSIONS.WORKFLOW.VIEW_EXECUTIONS)
  metrics(@CurrentUser() user: AuthContext) {
    return this.workflows.metrics(user);
  }

  @Get('events')
  @RequirePermissions(PERMISSIONS.WORKFLOW.VIEW_EXECUTIONS)
  events(@CurrentUser() user: AuthContext, @Query('limit') limit?: string) {
    return this.workflows.listEvents(user, limit ? Number(limit) : undefined);
  }

  @Get('executions')
  @RequirePermissions(PERMISSIONS.WORKFLOW.VIEW_EXECUTIONS)
  executions(@CurrentUser() user: AuthContext, @Query() q: ExecutionQueryDto) {
    return this.workflows.listExecutions(user, q);
  }

  @Get('executions/:id')
  @RequirePermissions(PERMISSIONS.WORKFLOW.VIEW_EXECUTIONS)
  execution(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.workflows.getExecution(user, id);
  }

  @Post('executions/:id/cancel')
  @RequirePermissions(PERMISSIONS.WORKFLOW.CANCEL_EXECUTION)
  cancel(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.workflows.cancelExecution(user, id, dto.reason);
  }

  @Get('dead-letters')
  @RequirePermissions(PERMISSIONS.WORKFLOW.VIEW_EXECUTIONS)
  deadLetters(
    @CurrentUser() user: AuthContext,
    @Query() q: DeadLetterQueryDto,
  ) {
    return this.workflows.listDeadLetters(user, q);
  }

  @Post('dead-letters/:id/retry')
  @RequirePermissions(PERMISSIONS.WORKFLOW.RETRY_EXECUTION)
  retry(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RetryDeadLetterDto,
  ) {
    return this.workflows.retryDeadLetter(
      user,
      id,
      dto.confirmFinancial === true,
    );
  }

  @Post('dead-letters/:id/cancel')
  @RequirePermissions(PERMISSIONS.WORKFLOW.CANCEL_EXECUTION)
  cancelDeadLetter(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.workflows.cancelDeadLetter(user, id, dto.reason);
  }

  @Post('dead-letters/:id/resolve')
  @RequirePermissions(PERMISSIONS.WORKFLOW.RETRY_EXECUTION)
  resolve(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ResolveDeadLetterDto,
  ) {
    return this.workflows.resolveDeadLetter(user, id, dto.note);
  }
}
