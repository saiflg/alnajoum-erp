import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { CorporateAccountsController } from './corporate-accounts.controller';
import { CorporateBookingsController } from './corporate-bookings.controller';
import { CorporateTravelService } from './corporate-travel.service';

@Module({
  // Order matters: "corporate-travel/accounts/:id/bookings" is nested under
  // accounts (creation only), while "corporate-travel/bookings" is its own
  // top-level list/get/cancel surface — no route ordering conflict since the
  // two controllers' paths don't overlap.
  imports: [UsersModule, PaymentsModule],
  controllers: [CorporateAccountsController, CorporateBookingsController],
  providers: [CorporateTravelService],
  exports: [CorporateTravelService],
})
export class CorporateTravelModule {}
