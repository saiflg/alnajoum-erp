import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { TaskRelatedType, TaskStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { UsersService } from '../users/users.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { TasksService } from './tasks.service';

@Controller('crm/tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly usersService: UsersService,
  ) {}

  private async requireStaffId(user: AuthContext): Promise<string> {
    const staffId = await this.usersService.getStaffIdForIdentity(user.sub);
    if (!staffId) {
      throw new ForbiddenException('Only staff can perform this action');
    }
    return staffId;
  }

  /** Any staff member can create a task assigned to themselves; assigning it to someone else needs TASK_MANAGE. */
  @Post()
  async create(@CurrentUser() user: AuthContext, @Body() dto: CreateTaskDto) {
    const staffId = await this.requireStaffId(user);
    if (
      dto.assignedStaffId !== staffId &&
      !user.permissions.includes(PERMISSIONS.CRM.TASK_MANAGE)
    ) {
      throw new ForbiddenException(
        'You can only assign tasks to yourself without CRM.TASK_MANAGE',
      );
    }
    return this.tasksService.create(dto, staffId);
  }

  @Get('me')
  async myTasks(@CurrentUser() user: AuthContext) {
    const staffId = await this.requireStaffId(user);
    return this.tasksService.myTasks(staffId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.TASK_MANAGE)
  listAll(
    @Query('assignedStaffId') assignedStaffId?: string,
    @Query('status') status?: TaskStatus,
    @Query('customerId') customerId?: string,
    @Query('leadId') leadId?: string,
    @Query('relatedType') relatedType?: TaskRelatedType,
  ) {
    return this.tasksService.listAll({
      assignedStaffId,
      status,
      customerId,
      leadId,
      relatedType,
    });
  }

  @Post(':id/status')
  async updateStatus(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() body: { status: TaskStatus },
  ) {
    const staffId = await this.requireStaffId(user);
    const task = await this.tasksService.get(id);
    if (
      task.assignedStaffId !== staffId &&
      !user.permissions.includes(PERMISSIONS.CRM.TASK_MANAGE)
    ) {
      throw new ForbiddenException(
        'You can only update your own tasks without CRM.TASK_MANAGE',
      );
    }
    return this.tasksService.updateStatus(id, body.status);
  }
}
