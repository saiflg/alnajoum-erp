export const STAFF_PAYOUT_PROVIDER = Symbol('STAFF_PAYOUT_PROVIDER');

export interface PayoutRequest {
  amount: number;
  currency: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  reference: string;
}

export interface PayoutResult {
  success: boolean;
  providerReference?: string;
  errorMessage?: string;
}

/**
 * Same provider-abstraction shape as FlightProviderPort/PaymentProviderPort
 * elsewhere in this codebase — swap the DI binding, not the call sites,
 * once a real bank-transfer/payroll API is available. Only a mock
 * implementation exists today (see MockStaffPayoutProviderService); there
 * is no real disbursement integration in this environment.
 */
export interface StaffPayoutProviderPort {
  sendPayout(request: PayoutRequest): Promise<PayoutResult>;
}
