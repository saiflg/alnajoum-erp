import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import {
  ActivateDto,
  CreateWorkflowDto,
  ReasonDto,
  SampleRunDto,
  SaveVersionDto,
  WorkflowListQueryDto,
} from './dto/workflow.dto';
import { WorkflowsService } from './workflows.service';

/** Workflow definitions: create, version, validate, test, dry-run, activate and change state. */
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WORKFLOW.VIEW)
  list(@CurrentUser() user: AuthContext, @Query() q: WorkflowListQueryDto) {
    return this.workflows.list(user, q);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.WORKFLOW.CREATE)
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateWorkflowDto) {
    return this.workflows.create(user, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.WORKFLOW.VIEW)
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.workflows.get(user, id);
  }

  @Put(':id/versions')
  @RequirePermissions(PERMISSIONS.WORKFLOW.EDIT)
  save(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: SaveVersionDto,
  ) {
    return this.workflows.saveVersion(user, id, dto);
  }

  @Get(':id/validate')
  @RequirePermissions(PERMISSIONS.WORKFLOW.VIEW)
  validate(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Query('version') version?: string,
  ) {
    return this.workflows.validateVersion(
      user,
      id,
      version ? Number(version) : undefined,
    );
  }

  @Post(':id/test')
  @RequirePermissions(PERMISSIONS.WORKFLOW.TEST)
  test(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: SampleRunDto,
  ) {
    return this.workflows.test(user, id, dto);
  }

  @Post(':id/dry-run')
  @RequirePermissions(PERMISSIONS.WORKFLOW.TEST)
  dryRun(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: SampleRunDto,
  ) {
    return this.workflows.dryRun(user, id, dto);
  }

  @Post(':id/activate')
  @RequirePermissions(PERMISSIONS.WORKFLOW.ACTIVATE)
  activate(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ActivateDto,
  ) {
    return this.workflows.activate(user, id, dto.versionNo);
  }

  @Post(':id/resume')
  @RequirePermissions(PERMISSIONS.WORKFLOW.ACTIVATE)
  resume(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.workflows.setStatus(user, id, 'ACTIVE');
  }

  @Post(':id/pause')
  @RequirePermissions(PERMISSIONS.WORKFLOW.PAUSE)
  pause(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.workflows.setStatus(user, id, 'PAUSED', dto.reason);
  }

  @Post(':id/disable')
  @RequirePermissions(PERMISSIONS.WORKFLOW.PAUSE)
  disable(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.workflows.setStatus(user, id, 'DISABLED', dto.reason);
  }

  @Post(':id/archive')
  @RequirePermissions(PERMISSIONS.WORKFLOW.PAUSE)
  archive(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.workflows.setStatus(user, id, 'ARCHIVED', dto.reason);
  }
}
