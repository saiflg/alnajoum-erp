import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CustomersModule } from '../customers/customers.module';
import { UsersModule } from '../users/users.module';
import { FlightBookingsAdminController } from './flight-bookings-admin.controller';
import { FlightBookingsOwnController } from './flight-bookings-own.controller';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { DuffelFlightProviderService } from './providers/duffel-flight-provider.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';
import { MockFlightProviderService } from './providers/mock-flight-provider.service';

@Module({
  imports: [ConfigModule, CustomersModule, UsersModule],
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
    {
      provide: FLIGHT_PROVIDER,
      inject: [
        ConfigService,
        MockFlightProviderService,
        DuffelFlightProviderService,
      ],
      useFactory: (
        configService: ConfigService,
        mockProvider: MockFlightProviderService,
        duffelProvider: DuffelFlightProviderService,
      ) =>
        configService.get<string>('FLIGHT_PROVIDER', 'mock') === 'duffel'
          ? duffelProvider
          : mockProvider,
    },
  ],
})
export class FlightsModule {}
