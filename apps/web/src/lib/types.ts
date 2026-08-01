export type IdentityType = 'CUSTOMER' | 'STAFF';

export interface CurrentUser {
  id: string;
  email: string;
  phone: string | null;
  type: IdentityType;
  status: string;
  roles: string[];
  permissions: string[];
  dashboardPath: string;
  profile: Record<string, unknown> | null;
}

export interface Company {
  id: string;
  name: string;
  legalName: string | null;
  registrationNumber: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface Branch {
  id: string;
  companyId: string;
  name: string;
  code: string;
  city: string | null;
  country: string | null;
  isHeadOffice: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
}

export interface StaffMember {
  id: string;
  identityId: string;
  companyId: string;
  branchId: string | null;
  employeeCode: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  isActive: boolean;
  identity?: { email: string; status: string };
}

export type DocumentType =
  | 'PASSPORT'
  | 'NATIONAL_ID'
  | 'VISA'
  | 'PHOTO'
  | 'VACCINATION_CERTIFICATE'
  | 'BIRTH_CERTIFICATE'
  | 'OTHER';

export interface CustomerDocument {
  id: string;
  customerId: string;
  type: DocumentType;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface CustomerProfile {
  id: string;
  identityId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  nationality: string | null;
  gender: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  passportNumber: string | null;
  passportExpiryDate: string | null;
  createdAt: string;
  identity?: { email: string; phone: string | null; status: string };
  documents?: CustomerDocument[];
  familyMembers?: FamilyMember[];
}

export type FamilyRelationship =
  | 'SPOUSE'
  | 'CHILD'
  | 'PARENT'
  | 'SIBLING'
  | 'GUARDIAN'
  | 'OTHER';

export interface FamilyMemberDocument {
  id: string;
  familyMemberId: string;
  type: DocumentType;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface FamilyMember {
  id: string;
  customerId: string;
  relationship: FamilyRelationship;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  nationality: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  passportNumber: string | null;
  passportExpiryDate: string | null;
  createdAt: string;
  documents?: FamilyMemberDocument[];
}

export type CabinClass = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
export type PassengerType = 'ADULT' | 'CHILD' | 'INFANT';
export type FlightBookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'FAILED';

export interface FlightSegment {
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  airline: string;
  airlineCode: string;
  flightNumber: string;
  cabinClass: CabinClass;
  durationMinutes: number;
}

export interface FlightOffer {
  id: string;
  provider: string;
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  returnDepartureAt?: string;
  returnArrivalAt?: string;
  cabinClass: CabinClass;
  currency: string;
  totalAmount: number;
  seatsAvailable: number;
  outboundSegments: FlightSegment[];
  returnSegments?: FlightSegment[];
  expiresAt: string;
}

export interface FlightBookingPassengerRecord {
  id: string;
  bookingId: string;
  type: PassengerType;
  customerId: string | null;
  familyMemberId: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  passportNumber: string | null;
  ticketNumber: string | null;
}

export interface FlightBooking {
  id: string;
  bookingReference: string;
  customerId: string;
  bookedByStaffId: string | null;
  provider: string;
  status: FlightBookingStatus;
  currency: string;
  totalAmount: number;
  origin: string;
  destination: string;
  departureAt: string;
  returnAt: string | null;
  cabinClass: CabinClass;
  createdAt: string;
  passengers: FlightBookingPassengerRecord[];
  customer?: { firstName: string; lastName: string };
}
