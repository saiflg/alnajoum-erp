import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CustomersModule } from '../customers/customers.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { FlightBookingsAdminController } from './flight-bookings-admin.controller';
import { FlightBookingsOwnController } from './flight-bookings-own.controller';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { AmadeusFlightProviderService } from './providers/amadeus-flight-provider.service';
import { DuffelFlightProviderService } from './providers/duffel-flight-provider.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';
import { FlightProviderRouter } from './providers/flight-provider.router';
import { MockFlightProviderService } from './providers/mock-flight-provider.service';
import { SabreFlightProviderService } from './providers/sabre-flight-provider.service';

@Module({
  imports: [
    ConfigModule,
    CustomersModule,
    UsersModule,
    PaymentsModule,
    NotificationsModule,
    IntegrationsModule,
  ],
  // Order matters: the static "flights/bookings/me" routes must be
  // registered before the dynamic "flights/bookings/:id" ones, otherwise
  // Express would match "me" as a booking id.
  controllers: [
    FlightsController,
    FlightBookingsOwnController,
    FlightBookingsAdminController,
  ],
  providers: [
    FlightsService,
    MockFlightProviderService,
    DuffelFlightProviderService,
    SabreFlightProviderService,
    AmadeusFlightProviderService,
    FlightProviderRouter,
    { provide: FLIGHT_PROVIDER, useExisting: FlightProviderRouter },
  ],
})
export class FlightsModule {}
