import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { FinanceModule } from '../finance/finance.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { HotelBookingsAdminController } from './hotel-bookings-admin.controller';
import { HotelBookingsOwnController } from './hotel-bookings-own.controller';
import { HotelCatalogController } from './hotel-catalog.controller';
import { HotelCatalogService } from './hotel-catalog.service';
import { HotelCompletionService } from './hotel-completion.service';
import { HotelIncentivesService } from './hotel-incentives.service';
import { HotelRefundsService } from './hotel-refunds.service';
import { HotelReportsController } from './hotel-reports.controller';
import { HotelReportsService } from './hotel-reports.service';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { CatalogHotelProviderService } from './providers/catalog-hotel-provider.service';
import { HOTEL_PROVIDER } from './providers/hotel-provider.port';
import { HotelProviderRouter } from './providers/hotel-provider.router';
import { MockHotelProviderService } from './providers/mock-hotel-provider.service';
import { TravelPackagesController } from './travel-packages.controller';
import { TravelPackagesService } from './travel-packages.service';

@Module({
  // Order matters: the static "hotels/bookings/me" and "hotels/catalog"
  // routes must be registered before "hotels/bookings/:id".
  imports: [
    CustomersModule,
    UsersModule,
    PaymentsModule,
    NotificationsModule,
    IntegrationsModule,
    AuditModule,
    FinanceModule,
  ],
  controllers: [
    HotelsController,
    HotelCatalogController,
    HotelBookingsOwnController,
    HotelBookingsAdminController,
    HotelReportsController,
    TravelPackagesController,
  ],
  providers: [
    HotelsService,
    HotelCatalogService,
    HotelCompletionService,
    HotelIncentivesService,
    HotelRefundsService,
    HotelReportsService,
    TravelPackagesService,
    MockHotelProviderService,
    CatalogHotelProviderService,
    HotelProviderRouter,
    { provide: HOTEL_PROVIDER, useExisting: HotelProviderRouter },
  ],
  exports: [HotelsService],
})
export class HotelsModule {}
