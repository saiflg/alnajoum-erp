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
  /** Real tenant context — null for customers, who aren't scoped to a company. */
  companyName: string | null;
  branchName: string | null;
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

export type CustomerType = 'INDIVIDUAL' | 'CORPORATE' | 'VIP' | 'GROUP';

export interface CustomerProfile {
  id: string;
  identityId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  nationality: string | null;
  gender: string | null;
  whatsapp: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  passportNumber: string | null;
  passportExpiryDate: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  customerType: CustomerType;
  assignedStaffId: string | null;
  assignedBranchId: string | null;
  createdAt: string;
  identity?: { email: string; phone: string | null; status: string };
  documents?: CustomerDocument[];
  familyMembers?: FamilyMember[];
  assignedStaff?: { id?: string; firstName: string; lastName: string } | null;
  assignedBranch?: { id?: string; name: string } | null;
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
export type TripType = 'ONE_WAY' | 'ROUND_TRIP' | 'MULTI_CITY';

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

export interface FlightLegOffer {
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  segments: FlightSegment[];
}

export interface FlightOffer {
  id: string;
  provider: string;
  tripType: TripType;
  legs: FlightLegOffer[];
  cabinClass: CabinClass;
  currency: string;
  totalAmount: number;
  seatsAvailable: number;
  expiresAt: string;
}

export interface FlightLegCriteria {
  origin: string;
  destination: string;
  departureDate: string;
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
  tripType: TripType;
  origin: string;
  destination: string;
  departureAt: string;
  cabinClass: CabinClass;
  /** Full offer snapshot at booking time, including every leg. */
  itinerary: FlightOffer;
  createdAt: string;
  passengers: FlightBookingPassengerRecord[];
  customer?: { firstName: string; lastName: string };
}

export type InvoiceStatus = 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
export type PaymentMethod =
  | 'CASH'
  | 'BANK_TRANSFER'
  | 'POS'
  | 'CARD'
  | 'OTHER'
  | 'ONLINE'
  | 'WALLET';

export interface InvoiceLineItem {
  id: string;
  invoiceId: string;
  description: string;
  amount: number;
}

export interface Payment {
  id: string;
  paymentReference: string;
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  note: string | null;
  recordedByStaffId: string | null;
  paidAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  flightBookingId: string | null;
  status: InvoiceStatus;
  currency: string;
  totalAmount: number;
  issuedByStaffId: string | null;
  createdAt: string;
  lineItems: InvoiceLineItem[];
  payments: Payment[];
  customer?: { firstName: string; lastName: string };
}

export type NotificationType =
  | 'STAFF_TEMP_PASSWORD'
  | 'BOOKING_CONFIRMATION'
  | 'PAYMENT_RECEIPT'
  | 'CONTACT_MESSAGE'
  | 'WALLET_DEPOSIT'
  | 'WALLET_DEBIT'
  | 'INSTALLMENT_REMINDER'
  | 'PAYMENT_OVERDUE'
  | 'HAJJ_UMRAH_DEADLINE'
  | 'DOCUMENT_MISSING'
  | 'MANUAL_PAYMENT_SUBMITTED'
  | 'MANUAL_PAYMENT_APPROVED'
  | 'MANUAL_PAYMENT_REJECTED';
export type NotificationStatus = 'SENT' | 'FAILED';

export interface Notification {
  id: string;
  type: NotificationType;
  recipient: string;
  subject: string;
  body: string;
  status: NotificationStatus;
  errorMessage: string | null;
  isRead?: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Phase 2 — Wallet
// ---------------------------------------------------------------------------

export type WalletTransactionType =
  | 'DEPOSIT'
  | 'PAYMENT'
  | 'REFUND'
  | 'ADJUSTMENT'
  | 'WITHDRAWAL'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT';
export type WalletTransactionStatus = 'PENDING' | 'COMPLETED' | 'REVERSED' | 'FAILED';

export interface WalletTransaction {
  id: string;
  walletId: string;
  type: WalletTransactionType;
  status: WalletTransactionStatus;
  amount: number;
  currency: string;
  description: string;
  reference: string;
  invoiceId: string | null;
  createdByStaffId: string | null;
  createdAt: string;
}

export interface Wallet {
  id: string;
  customerId: string;
  currency: string;
  createdAt: string;
  customer?: { id: string; firstName: string; lastName: string };
}

export interface WalletWithBalance {
  wallet: Wallet;
  balance: number;
  transactions: WalletTransaction[];
}

// ---------------------------------------------------------------------------
// Phase 2 — Hajj & Umrah
// ---------------------------------------------------------------------------

export type PackageStatus = 'DRAFT' | 'PUBLISHED' | 'FULLY_BOOKED' | 'CLOSED' | 'CANCELLED';
export type RegistrationStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
export type UmrahPackageType = 'GROUP' | 'FAMILY' | 'VIP' | 'ECONOMY' | 'CUSTOM';

export interface HajjPackage {
  id: string;
  name: string;
  description: string | null;
  price: number;
  internalCost?: number | null;
  currency: string;
  durationDays: number | null;
  departureDate: string | null;
  returnDate: string | null;
  airline: string | null;
  hotel: string | null;
  accommodation: string | null;
  transport: string | null;
  meals: string | null;
  visaIncluded: boolean;
  ziyaratIncluded: boolean;
  guideIncluded: boolean;
  maxPilgrims: number;
  seatsAvailable: number;
  paymentPlan: string | null;
  termsAndConditions: string | null;
  requiredDocuments: string | null;
  status: PackageStatus;
  createdAt: string;
}

export interface HajjRegistrationPilgrim {
  id: string;
  registrationId: string;
  customerId: string | null;
  familyMemberId: string | null;
  firstName: string;
  lastName: string;
  passportNumber: string | null;
}

export interface HajjRegistration {
  id: string;
  registrationNumber: string;
  packageId: string;
  customerId: string;
  registeredByStaffId: string | null;
  status: RegistrationStatus;
  currency: string;
  totalAmount: number;
  createdAt: string;
  pilgrims: HajjRegistrationPilgrim[];
  package: HajjPackage;
  invoice: Invoice | null;
  customer?: { firstName: string; lastName: string };
}

export interface UmrahPackage {
  id: string;
  name: string;
  description: string | null;
  packageType: UmrahPackageType;
  costPrice?: number;
  sellingPrice: number;
  currency: string;
  incentiveRule?: { percent: number } | null;
  hotel: string | null;
  flight: string | null;
  transport: string | null;
  visaIncluded: boolean;
  durationDays: number | null;
  departureDate: string | null;
  returnDate: string | null;
  maxPilgrims: number;
  seatsAvailable: number;
  status: PackageStatus;
  createdAt: string;
}

export interface UmrahRegistrationPilgrim {
  id: string;
  registrationId: string;
  customerId: string | null;
  familyMemberId: string | null;
  firstName: string;
  lastName: string;
  passportNumber: string | null;
}

export interface UmrahRegistration {
  id: string;
  registrationNumber: string;
  packageId: string;
  customerId: string;
  registeredByStaffId: string | null;
  status: RegistrationStatus;
  currency: string;
  totalAmount: number;
  createdAt: string;
  pilgrims: UmrahRegistrationPilgrim[];
  package: UmrahPackage;
  invoice: Invoice | null;
  customer?: { firstName: string; lastName: string };
}

// ---------------------------------------------------------------------------
// Phase 2 — Manual payments & staff incentives
// ---------------------------------------------------------------------------

export type ManualPaymentStatus =
  | 'PENDING_VERIFICATION'
  | 'APPROVED'
  | 'REJECTED'
  | 'CLARIFICATION_REQUESTED';

export interface ManualPaymentSubmission {
  id: string;
  invoiceId: string;
  customerId: string;
  amount: number;
  method: PaymentMethod;
  bankName: string | null;
  transactionReference: string | null;
  description: string | null;
  receiptDocumentPath: string | null;
  status: ManualPaymentStatus;
  submittedByStaffId: string | null;
  reviewedByStaffId: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  invoice?: { invoiceNumber: string };
  customer?: { firstName: string; lastName: string };
  submittedByStaff?: { firstName: string; lastName: string } | null;
  reviewedByStaff?: { firstName: string; lastName: string } | null;
}

export interface StaffIncentive {
  id: string;
  staffId: string;
  sourceType: string;
  sourceId: string;
  amount: number;
  currency: string;
  description: string;
  createdAt: string;
}
