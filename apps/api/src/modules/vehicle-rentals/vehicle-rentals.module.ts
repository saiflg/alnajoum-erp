import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { MockVehicleRentalProviderService } from './providers/mock-vehicle-rental-provider.service';
import { VEHICLE_RENTAL_PROVIDER } from './providers/vehicle-rental-provider.port';
import { VehicleRentalBookingsAdminController } from './vehicle-rental-bookings-admin.controller';
import { VehicleRentalBookingsOwnController } from './vehicle-rental-bookings-own.controller';
import { VehicleRentalsController } from './vehicle-rentals.controller';
import { VehicleRentalsService } from './vehicle-rentals.service';

@Module({
  imports: [CustomersModule, UsersModule, PaymentsModule, NotificationsModule],
  controllers: [
    VehicleRentalsController,
    VehicleRentalBookingsOwnController,
    VehicleRentalBookingsAdminController,
  ],
  providers: [
    VehicleRentalsService,
    MockVehicleRentalProviderService,
    { provide: VEHICLE_RENTAL_PROVIDER, useExisting: MockVehicleRentalProviderService },
  ],
})
export class VehicleRentalsModule {}
