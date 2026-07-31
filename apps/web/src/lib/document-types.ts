import { DocumentType } from './types';

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  PASSPORT: 'Passport',
  NATIONAL_ID: 'National ID',
  VISA: 'Visa',
  PHOTO: 'Photo',
  VACCINATION_CERTIFICATE: 'Vaccination Certificate',
  BIRTH_CERTIFICATE: 'Birth Certificate',
  OTHER: 'Other',
};

export const DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[];
