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
  | 'OTHER'
  | 'BANK_STATEMENT'
  | 'INVITATION_LETTER'
  | 'HOTEL_BOOKING'
  | 'FLIGHT_ITINERARY'
  | 'GUARANTOR_ID'
  | 'GUARANTOR_DOCUMENT';

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
export type FlightBookingStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'TICKETED'
  | 'REFUND_REQUESTED'
  | 'REFUNDED'
  | 'REISSUE_REQUESTED'
  | 'REISSUED'
  | 'CANCELLED'
  | 'FAILED';

export type FlightRefundStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED';

export type FlightReissueStatus =
  | 'REQUESTED'
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED';
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

export interface FareWarning {
  message: string;
  verified: boolean;
}

export interface FareConditions {
  refundable: 'REFUNDABLE' | 'PARTIALLY_REFUNDABLE' | 'NON_REFUNDABLE' | 'UNKNOWN';
  changePenaltyDescription?: string;
  cancellationPenaltyDescription?: string;
  baggageAllowance?: { checked?: string; cabin?: string };
  fareBrand?: string;
  warnings: FareWarning[];
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
  fareConditions?: FareConditions;
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
  pnr: string | null;
  ticketedAt: string | null;
  providerWarnings: FareWarning[] | null;
  fareRules: FareConditions | null;
  refundable: boolean | null;
  baggageAllowance: { checked?: string; cabin?: string } | null;
  providerCost: number | null;
  markupAmount: number | null;
}

export interface FlightRefund {
  id: string;
  bookingId: string;
  ticketPrice: number;
  providerPenalty: number;
  agencyFee: number;
  refundableTaxes: number;
  refundAmount: number;
  currency: string;
  status: FlightRefundStatus;
  reason: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface FlightReissue {
  id: string;
  bookingId: string;
  fareDifference: number;
  changePenalty: number;
  totalDue: number;
  currency: string;
  status: FlightReissueStatus;
  createdAt: string;
  completedAt: string | null;
}

export interface RefundPreview {
  ticketPrice: number;
  estimatedProviderPenalty: number;
  agencyFee: number;
  estimatedRefundAmount: number;
  currency: string;
  refundable: boolean | null;
  fareRules: FareConditions | null;
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
  // Null for a corporate travel invoice — those bill a CorporateAccount
  // instead of an individual Customer (see the backend's Invoice.customerId
  // comment in schema.prisma).
  customerId: string | null;
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

export type IncentiveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';

export interface StaffIncentive {
  id: string;
  staffId: string;
  sourceType: string;
  sourceId: string;
  amount: number;
  currency: string;
  description: string;
  createdAt: string;
  status: IncentiveStatus;
  referenceNumber: string | null;
  companyCost: number | null;
  sellingPrice: number | null;
  margin: number | null;
  policyId: string | null;
  customerId: string | null;
  approvedByStaffId: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  staff?: { firstName: string; lastName: string; employeeCode: string };
  customer?: { firstName: string; lastName: string };
  payout?: StaffPayout | null;
}

export type IncentivePolicyType =
  | 'FULL_MARGIN'
  | 'PERCENT_OF_MARGIN'
  | 'FIXED_AMOUNT'
  | 'STAFF_COMPANY_SPLIT'
  | 'STAFF_BRANCH_COMPANY_SPLIT'
  | 'CUSTOM';

export interface IncentivePolicy {
  id: string;
  name: string;
  type: IncentivePolicyType;
  config: { percent?: number; amount?: number; staffPercent?: number; branchPercent?: number };
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
}

export type PayoutStatus = 'PENDING' | 'PROCESSING' | 'SUCCESSFUL' | 'FAILED';

export interface StaffPayout {
  id: string;
  incentiveId: string;
  staffId: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  provider: string;
  providerReference: string | null;
  providerError: string | null;
  createdAt: string;
  staff?: { firstName: string; lastName: string; employeeCode: string };
  incentive?: StaffIncentive;
}

// ---------------------------------------------------------------------------
// Integrations — provider credentials configurable at /admin/integrations
// ---------------------------------------------------------------------------

export type IntegrationCategory = 'FLIGHT' | 'PAYMENT' | 'NOTIFICATION';

export interface IntegrationFieldSpec {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
}

export interface IntegrationProvider {
  provider: string;
  label: string;
  implemented: boolean;
  docsUrl?: string;
  fields: IntegrationFieldSpec[];
  isActive: boolean;
  /** Which field keys have a value saved — never the values themselves. */
  configuredFields: string[];
  updatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Hotels
// ---------------------------------------------------------------------------

export type HotelBookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

export interface HotelOffer {
  id: string;
  provider: 'MOCK';
  hotelName: string;
  city: string;
  country: string;
  starRating: number;
  roomType: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: number;
  guests: number;
  currency: string;
  totalAmount: number;
  amenities: string[];
  expiresAt: string;
}

export interface HotelBooking {
  id: string;
  bookingReference: string;
  customerId: string;
  bookedByStaffId: string | null;
  status: HotelBookingStatus;
  currency: string;
  totalAmount: number;
  hotelName: string;
  city: string;
  country: string;
  starRating: number;
  roomType: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: number;
  guests: number;
  createdAt: string;
  customer?: { firstName: string; lastName: string };
}

// ---------------------------------------------------------------------------
// Vehicle rentals — car, van, bus
// ---------------------------------------------------------------------------

export type VehicleType = 'CAR' | 'VAN' | 'BUS';
export type VehicleRentalStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

export interface VehicleRentalOffer {
  id: string;
  provider: 'MOCK';
  vehicleType: VehicleType;
  vehicleName: string;
  pickupCity: string;
  pickupAt: string;
  dropoffAt: string;
  withDriver: boolean;
  seats: number;
  currency: string;
  totalAmount: number;
  features: string[];
  expiresAt: string;
}

export interface VehicleRental {
  id: string;
  bookingReference: string;
  customerId: string;
  bookedByStaffId: string | null;
  status: VehicleRentalStatus;
  currency: string;
  totalAmount: number;
  vehicleType: VehicleType;
  vehicleName: string;
  pickupCity: string;
  pickupLocation: string;
  dropoffLocation: string;
  pickupAt: string;
  dropoffAt: string;
  withDriver: boolean;
  createdAt: string;
  customer?: { firstName: string; lastName: string };
}

// ---------------------------------------------------------------------------
// Visa processing
// ---------------------------------------------------------------------------

export type VisaType =
  | 'TOURIST'
  | 'BUSINESS'
  | 'STUDENT'
  | 'WORK'
  | 'TRANSIT'
  | 'PILGRIMAGE'
  | 'OTHER';

export type VisaApplicationStatus =
  // Phase 2
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'ADDITIONAL_DOCUMENTS_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ISSUED'
  | 'CANCELLED'
  // Phase 3 — catalog-linked applications use this richer set
  | 'DRAFT'
  | 'AWAITING_DOCUMENTS'
  | 'AWAITING_GUARANTOR'
  | 'GUARANTOR_VERIFICATION'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_VERIFIED'
  | 'UNDER_REVIEW'
  | 'SUBMITTED_TO_PROVIDER'
  | 'PROCESSING'
  | 'ADDITIONAL_INFO_REQUIRED'
  | 'COMPLETED';

export type VisaServiceStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED' | 'ARCHIVED';

export interface VisaService {
  id: string;
  serviceCode: string;
  country: string;
  visaType: string;
  visaCategory: string | null;
  description: string | null;
  processingTime: string | null;
  validityPeriod: string | null;
  entryType: string | null;
  requiredDocuments: string | null;
  supplierName: string | null;
  supplierCost: number | null;
  companyCost: number;
  sellingPrice: number;
  margin: number;
  currency: string;
  processingFee: number;
  otherFees: number;
  incentivePolicyId: string | null;
  incentivePolicy?: IncentivePolicy | null;
  termsAndConditions: string | null;
  isAvailable: boolean;
  requiresGuarantor: boolean;
  status: VisaServiceStatus;
  createdAt: string;
}

/** Customer-facing shape — no cost/margin fields (see VisaPublicController on the API side). */
export interface PublicVisaService {
  id: string;
  serviceCode: string;
  country: string;
  visaType: string;
  visaCategory: string | null;
  description: string | null;
  processingTime: string | null;
  validityPeriod: string | null;
  entryType: string | null;
  requiredDocuments: string | null;
  currency: string;
  price: number;
  termsAndConditions: string | null;
}

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Guarantor {
  id: string;
  fullName: string;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  relationship: string;
  idType: string | null;
  idNumber: string | null;
  verificationStatus: VerificationStatus;
  approvalStatus: ApprovalStatus;
  acceptedResponsibilityAt: string | null;
  verificationNote: string | null;
  createdAt: string;
}

export type VisaDocumentStatus = 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';

export interface VisaDocument {
  id: string;
  applicationId: string | null;
  guarantorId: string | null;
  type: DocumentType;
  originalFileName: string;
  storedFileName: string;
  mimeType: string;
  sizeBytes: number;
  expiryDate: string | null;
  status: VisaDocumentStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface VisaApplicationNote {
  id: string;
  applicationId: string;
  staffId: string;
  note: string;
  createdAt: string;
  staff?: { firstName: string; lastName: string };
}

export interface VisaApplication {
  id: string;
  applicationReference: string;
  customerId: string;
  familyMemberId: string | null;
  destinationCountry: string;
  visaType: VisaType;
  intendedTravelDate: string | null;
  applicantFirstName: string;
  applicantLastName: string;
  applicantPassportNumber: string | null;
  status: VisaApplicationStatus;
  staffNote: string | null;
  currency: string;
  totalAmount: number;
  notes: string | null;
  createdAt: string;
  invoice?: Invoice | null;
  customer?: { firstName: string; lastName: string };
  // Phase 3
  visaServiceId: string | null;
  visaService?: Omit<VisaService, 'companyCost' | 'supplierCost' | 'supplierName' | 'incentivePolicyId' | 'incentivePolicy'> | null;
  guarantorId: string | null;
  guarantor?: Guarantor | null;
  guarantorRequired: boolean;
  guarantorExempt: boolean;
  guarantorExemptReason: string | null;
  previousVisaInfo: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  isOfflineEntry: boolean;
  offlineReason: string | null;
  assignedStaffId: string | null;
  assignedStaff?: { firstName: string; lastName: string } | null;
}

// ---------------------------------------------------------------------------
// Corporate travel — staff-managed accounts, traveler rosters, and
// consolidated bookings for a corporate client's traveling employees.
// ---------------------------------------------------------------------------

export interface CorporateAccount {
  id: string;
  name: string;
  registrationNumber: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  billingAddress: string | null;
  contactPersonName: string | null;
  managedBranchId: string | null;
  isActive: boolean;
  createdAt: string;
  managedBranch?: { name: string } | null;
  travelers?: CorporateTraveler[];
}

export interface CorporateTraveler {
  id: string;
  corporateAccountId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  passportNumber: string | null;
  isActive: boolean;
  createdAt: string;
}

export type CorporateBookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

export interface CorporateBookingTraveler {
  id: string;
  travelerId: string;
  description: string;
  amount: number;
  traveler: CorporateTraveler;
}

export interface CorporateBooking {
  id: string;
  bookingReference: string;
  corporateAccountId: string;
  bookedByStaffId: string;
  description: string;
  status: CorporateBookingStatus;
  currency: string;
  totalAmount: number;
  createdAt: string;
  corporateAccount?: { name: string };
  travelers: CorporateBookingTraveler[];
  invoice?: Invoice | null;
}
