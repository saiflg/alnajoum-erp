import { DocumentType } from './types';

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  PASSPORT: 'Passport',
  NATIONAL_ID: 'National ID',
  VISA: 'Visa',
  PHOTO: 'Photo',
  VACCINATION_CERTIFICATE: 'Vaccination Certificate',
  BIRTH_CERTIFICATE: 'Birth Certificate',
  OTHER: 'Other',
  BANK_STATEMENT: 'Bank Statement',
  INVITATION_LETTER: 'Invitation Letter',
  HOTEL_BOOKING: 'Hotel Booking',
  FLIGHT_ITINERARY: 'Flight Itinerary',
  GUARANTOR_ID: "Guarantor's ID",
  GUARANTOR_DOCUMENT: 'Guarantor Document',
};

export const DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[];
