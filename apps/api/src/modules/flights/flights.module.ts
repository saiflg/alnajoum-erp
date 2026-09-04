import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { FinanceModule } from '../finance/finance.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { FlightBookingsAdminController } from './flight-bookings-admin.controller';
import { FlightBookingsOwnController } from './flight-bookings-own.controller';
import { FlightGroupBookingsController } from './flight-group-bookings.controller';
import { FlightGroupBookingsService } from './flight-group-bookings.service';
import { FlightIncentivesService } from './flight-incentives.service';
import { FlightPricingRulesController } from './flight-pricing-rules.controller';
import { FlightPricingService } from './flight-pricing.service';
import { FlightRefundsService } from './flight-refunds.service';
import { FlightReissueService } from './flight-reissue.service';
import { FlightReportsController } from './flight-reports.controller';
import { FlightReportsService } from './flight-reports.service';
import { FlightTicketingService } from './flight-ticketing.service';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { ProviderTransactionLogService } from './provider-transaction-log.service';
import { AmadeusFlightProviderService } from './providers/amadeus-flight-provider.service';
import { DuffelFlightProviderService } from './providers/duffel-flight-provider.service';
import { FLIGHT_PROVIDER } from './providers/flight-provider.port';
import { FlightProviderRouter } from './providers/flight-provider.router';
import { MockFlightProviderService } from './providers/mock-flight-provider.service';
import { SabreFlightProviderService } from './providers/sabre-flight-provider.service';
import { TboFlightProviderService } from './providers/tbo-flight-provider.service';
import { TravelportFlightProviderService } from './providers/travelport-flight-provider.service';

@Module({
  imports: [
    ConfigModule,
    CustomersModule,
    UsersModule,
    PaymentsModule,
    NotificationsModule,
    IntegrationsModule,
    AuditModule,
    FinanceModule,
  ],
  // Order matters: the static "flights/bookings/me" routes must be
  // registered before the dynamic "flights/bookings/:id" ones, otherwise
  // Express would match "me" as a booking id. Same reasoning for
  // "flights/pricing-rules"/"flights/group-bookings"/"flights/reports"
  // ahead of "flights/bookings/:id" — none of them collide in practice
  // since they're different sub-paths, but keeping the specific-before-
  // dynamic convention consistent avoids surprises later.
  controllers: [
    FlightsController,
    FlightBookingsOwnController,
    FlightBookingsAdminController,
    FlightPricingRulesController,
    FlightGroupBookingsController,
    FlightReportsController,
  ],
  providers: [
    FlightsService,
    FlightPricingService,
    FlightIncentivesService,
    FlightTicketingService,
    FlightRefundsService,
    FlightReissueService,
    FlightGroupBookingsService,
    FlightReportsService,
    ProviderTransactionLogService,
    MockFlightProviderService,
    DuffelFlightProviderService,
    SabreFlightProviderService,
    AmadeusFlightProviderService,
    TravelportFlightProviderService,
    TboFlightProviderService,
    FlightProviderRouter,
    { provide: FLIGHT_PROVIDER, useExisting: FlightProviderRouter },
  ],
  exports: [FlightsService],
})
export class FlightsModule {}
