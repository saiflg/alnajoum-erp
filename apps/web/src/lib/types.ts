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
