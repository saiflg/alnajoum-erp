import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

/**
 * The only truly public (unauthenticated) write endpoint in the API —
 * reachable from the marketing site's contact form. Rate-limited by the
 * app-wide ThrottlerGuard like every other route.
 */
@Controller('contact')
export class ContactController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Public()
  @Post()
  async submit(@Body() dto: CreateContactMessageDto) {
    await this.notificationsService.sendContactMessage(dto);
    return { received: true };
  }
}
