import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { VisaModule } from '../visa/visa.module';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

@Module({
  imports: [NotificationsModule, VisaModule],
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}
