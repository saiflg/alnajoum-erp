import { Controller, Post } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { RemindersService } from './reminders.service';

@Controller('reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Post('run')
  @RequirePermissions(PERMISSIONS.REMINDER.RUN)
  run() {
    return this.remindersService.runAll();
  }
}
