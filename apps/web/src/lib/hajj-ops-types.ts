export type TravelGroupStatus =
  | 'PLANNING'
  | 'REGISTRATION_OPEN'
  | 'ALMOST_FULL'
  | 'FULL'
  | 'DEPARTED'
  | 'IN_SAUDI_ARABIA'
  | 'RETURNING'
  | 'COMPLETED'
  | 'CANCELLED';

export type UmrahGroupType = 'INDIVIDUAL' | 'FAMILY' | 'GROUP' | 'CORPORATE' | 'VIP';

export type ReadinessStatus = 'GREEN' | 'AMBER' | 'RED';

export type PilgrimType = 'HAJJ' | 'UMRAH';

export interface GroupPilgrim {
  id: string;
  firstName: string;
  lastName: string;
  passportNumber: string | null;
  customer: { firstName: string; lastName: string } | null;
  familyMember: { firstName: string; lastName: string } | null;
  registration: { registrationNumber: string } | null;
}

export interface HajjOpsGroup {
  id: string;
  groupNumber: string;
  name: string;
  groupType?: UmrahGroupType;
  status: TravelGroupStatus;
  packageId: string | null;
  departureDate: string | null;
  returnDate: string | null;
  airline: string | null;
  maxCapacity: number | null;
  coordinatorStaffId: string | null;
  coordinatorStaff: { firstName: string; lastName: string } | null;
  notes: string | null;
  package?: { name: string } | null;
  pilgrims: GroupPilgrim[];
  transports: unknown[];
  _count?: { pilgrims: number };
}

export interface PilgrimReadiness {
  pilgrimType: PilgrimType;
  pilgrimId: string;
  documentsComplete: boolean;
  missingDocuments: string[];
  visaStatus: 'NOT_APPLIED' | 'IN_PROGRESS' | 'APPROVED';
  paymentComplete: boolean;
  outstandingAmount: number;
  flightAssigned: boolean;
  hotelAssigned: boolean;
  computedStatus: ReadinessStatus;
  override: { status: ReadinessStatus; reason: string; overriddenAt: string } | null;
  finalStatus: ReadinessStatus;
}

export interface Vehicle {
  id: string;
  plateNumber: string;
  type: 'BUS' | 'VAN' | 'SEDAN' | 'SUV' | 'OTHER';
  capacity: number;
  status: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'OUT_OF_SERVICE';
  notes: string | null;
}

export interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  licenseNumber?: string;
  status: 'ACTIVE' | 'INACTIVE';
  vehicleId: string | null;
  vehicle: { plateNumber: string; type: string } | null;
}

export interface Transport {
  id: string;
  type:
    | 'AIRPORT_TRANSFER'
    | 'MAKKAH_TRANSPORT'
    | 'MADINAH_TRANSPORT'
    | 'INTERCITY'
    | 'GROUP_BUS'
    | 'PRIVATE_VEHICLE';
  hajjGroupId: string | null;
  umrahGroupId: string | null;
  pickupLocation: string;
  dropoffLocation: string;
  scheduledAt: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  vehicle: { plateNumber: string; type: string } | null;
  driver: { firstName: string; lastName: string; phone: string } | null;
}

export interface RoomOccupant {
  id: string;
  pilgrimType: PilgrimType;
  pilgrimId: string;
  checkedInAt: string | null;
}

export interface RoomAllocation {
  id: string;
  hajjGroupId: string | null;
  umrahGroupId: string | null;
  hotelName: string;
  roomType: string | null;
  roomNumber: string;
  capacity: number;
  occupants: RoomOccupant[];
}
