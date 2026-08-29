import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { HotelBookingsAdminController } from './hotel-bookings-admin.controller';
import { HotelBookingsOwnController } from './hotel-bookings-own.controller';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { HOTEL_PROVIDER } from './providers/hotel-provider.port';
import { MockHotelProviderService } from './providers/mock-hotel-provider.service';

@Module({
  // Order matters: the static "hotels/bookings/me" routes must be
  // registered before the dynamic "hotels/bookings/:id" ones.
  imports: [CustomersModule, UsersModule, PaymentsModule, NotificationsModule],
  controllers: [HotelsController, HotelBookingsOwnController, HotelBookingsAdminController],
  providers: [
    HotelsService,
    MockHotelProviderService,
    // Only one provider today — kept behind the HOTEL_PROVIDER token (not
    // MockHotelProviderService injected directly) so a real one (Booking.com,
    // Expedia Rapid, Amadeus Hotel Search, ...) is a DI binding change here
    // later, matching FlightsModule/PaymentsModule/NotificationsModule's
    // pattern. Not wired through IntegrationsModule/a router yet since
    // there's no second real provider to switch to — add that the same way
    // FlightProviderRouter was added once one exists.
    { provide: HOTEL_PROVIDER, useExisting: MockHotelProviderService },
  ],
})
export class HotelsModule {}
