/**
 * Phase 2 + 3 demo data: fictional customers, a family group, wallet
 * activity, Hajj/Umrah packages and registrations, a manual payment
 * awaiting review, staff assignment, in-app notifications, and (Phase 3)
 * a visa service catalog, incentive policies, guarantors, visa
 * applications across 9 statuses, documents, staff incentives, and
 * payouts — enough to exercise every screen without registering through
 * the UI first.
 *
 * Entirely separate from seed.ts (the Phase 1 bootstrap: permissions,
 * roles, the first Company/Branch/Super Admin) — this only ever ADDS demo
 * records under obviously-fictional @demo.alnajoum.travel addresses, never
 * touches real customer accounts. Each phase's seeding function is
 * independently idempotent (see seedPhase1And2 and seedPhase3Visa) — safe
 * to re-run at any time, including after only one of the two phases has
 * ever run; neither ever needs a destructive reset to pick up the other.
 *
 * All names, passport numbers, phone numbers, and bank details below are
 * fictional. Nothing here is a real document, account, or API credential.
 *
 * Run: pnpm --filter api run db:seed:demo
 * Full reset + reseed (asks for confirmation — destroys all data first): pnpm --filter api run db:reset:demo
 */
import {
  PrismaClient,
  PackageStatus,
  RegistrationStatus,
  WalletTransactionType,
  WalletTransactionStatus,
  PaymentMethod,
  InvoiceStatus,
  ManualPaymentStatus,
  NotificationType,
  NotificationStatus,
  VisaServiceStatus,
  VisaApplicationStatus,
  VisaType,
  IncentivePolicyType,
  IncentiveStatus,
  VerificationStatus,
  ApprovalStatus,
  DocumentType,
  VisaDocumentStatus,
  PayoutStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { SYSTEM_ROLES } from '../src/modules/rbac/constants/default-roles.constant';
import {
  ACCOUNT_CODES,
  SEED_ACCOUNTS,
} from '../src/modules/finance/constants/account-codes.constant';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Demo@2026';
const MARKER_EMAIL = 'amina.yusuf@demo.alnajoum.travel';

function ref(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** Phase 1/2 demo data — customers, family, Hajj/Umrah, wallet, manual payment. */
async function seedPhase1And2() {
  const existing = await prisma.identity.findUnique({
    where: { email: MARKER_EMAIL },
  });
  if (existing) {
    console.log('Phase 1/2 demo data already present — skipping');
    return;
  }

  const company = await prisma.company.findFirstOrThrow();
  const branch = await prisma.branch.findFirstOrThrow({
    where: { companyId: company.id },
  });
  const staffRole = await prisma.role.findUniqueOrThrow({
    where: { name: SYSTEM_ROLES.STAFF },
  });
  const financeRole = await prisma.role.findUniqueOrThrow({
    where: { name: SYSTEM_ROLES.FINANCE_OFFICER },
  });

  // --- Demo staff: a front-line agent and a finance officer -----------------
  const staffPasswordHash = await argon2.hash(DEMO_PASSWORD);

  const agentIdentity = await prisma.identity.create({
    data: {
      email: 'fatima.sule@demo.alnajoum.travel',
      passwordHash: staffPasswordHash,
      type: 'STAFF',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      staff: {
        create: {
          companyId: company.id,
          branchId: branch.id,
          employeeCode: 'DEMO-AG01',
          firstName: 'Fatima',
          lastName: 'Sule',
          jobTitle: 'Travel Consultant',
          department: 'Sales',
        },
      },
      roles: { create: [{ roleId: staffRole.id }] },
    },
    include: { staff: true },
  });

  const financeIdentity = await prisma.identity.create({
    data: {
      email: 'ibrahim.musa@demo.alnajoum.travel',
      passwordHash: staffPasswordHash,
      type: 'STAFF',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      staff: {
        create: {
          companyId: company.id,
          branchId: branch.id,
          employeeCode: 'DEMO-FN01',
          firstName: 'Ibrahim',
          lastName: 'Musa',
          jobTitle: 'Finance Officer',
          department: 'Finance',
        },
      },
      roles: { create: [{ roleId: financeRole.id }] },
    },
    include: { staff: true },
  });

  console.log(
    `Created demo staff: ${agentIdentity.email}, ${financeIdentity.email} (password: ${DEMO_PASSWORD})`,
  );

  // --- Demo customers ---------------------------------------------------
  const customerPasswordHash = await argon2.hash(DEMO_PASSWORD);

  const aminaIdentity = await prisma.identity.create({
    data: {
      email: MARKER_EMAIL,
      phone: '+2348000000101',
      passwordHash: customerPasswordHash,
      type: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      roles: {
        create: [
          {
            roleId: (
              await prisma.role.findUniqueOrThrow({
                where: { name: SYSTEM_ROLES.CUSTOMER },
              })
            ).id,
          },
        ],
      },
      customer: {
        create: {
          firstName: 'Amina',
          lastName: 'Yusuf',
          dateOfBirth: new Date('1985-04-12'),
          nationality: 'Nigerian',
          gender: 'FEMALE',
          whatsapp: '+2348000000101',
          address: '14 Ahmadu Bello Way',
          city: 'Kaduna',
          state: 'Kaduna',
          country: 'Nigeria',
          passportNumber: 'A00100101',
          passportExpiryDate: new Date('2030-06-01'),
          emergencyContactName: 'Yusuf Abdullahi',
          emergencyContactPhone: '+2348000000102',
          customerType: 'INDIVIDUAL',
          assignedStaffId: agentIdentity.staff!.id,
          assignedBranchId: branch.id,
        },
      },
    },
    include: { customer: true },
  });

  const chineduIdentity = await prisma.identity.create({
    data: {
      email: 'chinedu.okafor@demo.alnajoum.travel',
      phone: '+2348000000201',
      passwordHash: customerPasswordHash,
      type: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      roles: {
        create: [
          {
            roleId: (
              await prisma.role.findUniqueOrThrow({
                where: { name: SYSTEM_ROLES.CUSTOMER },
              })
            ).id,
          },
        ],
      },
      customer: {
        create: {
          firstName: 'Chinedu',
          lastName: 'Okafor',
          dateOfBirth: new Date('1978-11-03'),
          nationality: 'Nigerian',
          gender: 'MALE',
          whatsapp: '+2348000000201',
          address: '22 Awolowo Road',
          city: 'Lagos',
          state: 'Lagos',
          country: 'Nigeria',
          passportNumber: 'A00200201',
          passportExpiryDate: new Date('2029-02-15'),
          emergencyContactName: 'Ngozi Okafor',
          emergencyContactPhone: '+2348000000202',
          customerType: 'VIP',
          assignedStaffId: agentIdentity.staff!.id,
          assignedBranchId: branch.id,
        },
      },
    },
    include: { customer: true },
  });

  console.log(
    `Created demo customers: ${aminaIdentity.email}, ${chineduIdentity.email} (password: ${DEMO_PASSWORD})`,
  );

  // --- Family group for Amina: spouse + two children ---------------------
  const spouse = await prisma.familyMember.create({
    data: {
      customerId: aminaIdentity.customer!.id,
      relationship: 'SPOUSE',
      firstName: 'Yusuf',
      lastName: 'Abdullahi',
      dateOfBirth: new Date('1982-09-20'),
      nationality: 'Nigerian',
      gender: 'MALE',
      passportNumber: 'A00100102',
      passportExpiryDate: new Date('2030-06-01'),
    },
  });
  const child1 = await prisma.familyMember.create({
    data: {
      customerId: aminaIdentity.customer!.id,
      relationship: 'CHILD',
      firstName: 'Zainab',
      lastName: 'Yusuf',
      dateOfBirth: new Date('2012-01-15'),
      nationality: 'Nigerian',
      gender: 'FEMALE',
      passportNumber: 'A00100103',
      passportExpiryDate: new Date('2030-06-01'),
    },
  });
  await prisma.familyMember.create({
    data: {
      customerId: aminaIdentity.customer!.id,
      relationship: 'CHILD',
      firstName: 'Bilal',
      lastName: 'Yusuf',
      dateOfBirth: new Date('2015-07-22'),
      nationality: 'Nigerian',
      gender: 'MALE',
      passportNumber: 'A00100104',
      passportExpiryDate: new Date('2030-06-01'),
    },
  });
  console.log(
    'Created a 4-member family group for Amina Yusuf (spouse + 2 children)',
  );

  // --- Hajj packages -------------------------------------------------------
  const hajjStandard = await prisma.hajjPackage.create({
    data: {
      name: 'Standard Hajj 2027',
      description:
        'Economy-tier Hajj package with shared accommodation near Haram.',
      price: 6_000_000,
      internalCost: 4_800_000,
      currency: 'NGN',
      durationDays: 21,
      departureDate: new Date('2027-05-20'),
      returnDate: new Date('2027-06-10'),
      airline: 'Saudia',
      hotel: 'Al Kiswah Towers',
      accommodation: 'Quad sharing',
      transport: 'Coach transfers',
      meals: 'Full board',
      visaIncluded: true,
      ziyaratIncluded: true,
      guideIncluded: true,
      maxPilgrims: 200,
      seatsAvailable: 197,
      paymentPlan:
        'Deposit ₦500,000, then flexible installments before departure.',
      termsAndConditions:
        'Full balance due 30 days before departure. Non-refundable deposit.',
      requiredDocuments:
        'Passport, passport photograph, yellow fever card, vaccination certificate',
      status: PackageStatus.PUBLISHED,
    },
  });
  await prisma.hajjPackage.create({
    data: {
      name: 'Premium Hajj 2027',
      description:
        'Premium Hajj package with private hotel rooms close to Haram.',
      price: 12_000_000,
      internalCost: 9_500_000,
      currency: 'NGN',
      durationDays: 21,
      departureDate: new Date('2027-05-18'),
      returnDate: new Date('2027-06-12'),
      airline: 'Emirates',
      hotel: 'Swissotel Al Maqam Makkah',
      accommodation: 'Private double room',
      transport: 'Private coach',
      meals: 'Full board',
      maxPilgrims: 60,
      seatsAvailable: 60,
      paymentPlan: 'Deposit ₦1,000,000, then monthly installments.',
      status: PackageStatus.PUBLISHED,
    },
  });
  await prisma.hajjPackage.create({
    data: {
      name: 'Hajj 2028 (Planning)',
      price: 6_500_000,
      currency: 'NGN',
      maxPilgrims: 200,
      seatsAvailable: 200,
      status: PackageStatus.DRAFT,
    },
  });

  // --- Umrah packages --------------------------------------------------
  const umrahEconomy = await prisma.umrahPackage.create({
    data: {
      name: 'Economy Umrah — 10 Days',
      description: 'Budget-friendly group Umrah package.',
      packageType: 'ECONOMY',
      costPrice: 550_000,
      sellingPrice: 750_000,
      currency: 'NGN',
      incentiveRule: { percent: 2 },
      hotel: 'Al Massa Hotel',
      flight: 'Air Peace',
      transport: 'Shared coach',
      visaIncluded: true,
      durationDays: 10,
      departureDate: new Date('2026-11-05'),
      returnDate: new Date('2026-11-15'),
      maxPilgrims: 40,
      seatsAvailable: 38,
      status: PackageStatus.PUBLISHED,
    },
  });
  await prisma.umrahPackage.create({
    data: {
      name: 'VIP Umrah — Family Package',
      description: 'Private VIP package for families, 5-star accommodation.',
      packageType: 'VIP',
      costPrice: 1_400_000,
      sellingPrice: 1_950_000,
      currency: 'NGN',
      incentiveRule: { percent: 3.5 },
      hotel: 'Pullman Zamzam Makkah',
      flight: 'Qatar Airways',
      transport: 'Private car',
      visaIncluded: true,
      durationDays: 12,
      departureDate: new Date('2026-12-10'),
      returnDate: new Date('2026-12-22'),
      maxPilgrims: 20,
      seatsAvailable: 20,
      status: PackageStatus.PUBLISHED,
    },
  });

  // --- Hajj registration for Amina's family, with a partial installment ---
  const hajjPilgrims = [
    {
      customerId: aminaIdentity.customer!.id,
      familyMemberId: null,
      firstName: 'Amina',
      lastName: 'Yusuf',
      passportNumber: 'A00100101',
    },
    {
      customerId: null,
      familyMemberId: spouse.id,
      firstName: spouse.firstName,
      lastName: spouse.lastName,
      passportNumber: spouse.passportNumber,
    },
    {
      customerId: null,
      familyMemberId: child1.id,
      firstName: child1.firstName,
      lastName: child1.lastName,
      passportNumber: child1.passportNumber,
    },
  ];
  const hajjTotal = hajjStandard.price * hajjPilgrims.length;

  const hajjRegistration = await prisma.hajjRegistration.create({
    data: {
      registrationNumber: ref('HAJJ'),
      packageId: hajjStandard.id,
      customerId: aminaIdentity.customer!.id,
      registeredByStaffId: agentIdentity.staff!.id,
      status: RegistrationStatus.CONFIRMED,
      currency: hajjStandard.currency,
      totalAmount: hajjTotal,
      pilgrims: { create: hajjPilgrims },
    },
  });
  await prisma.hajjPackage.update({
    where: { id: hajjStandard.id },
    data: { seatsAvailable: { decrement: hajjPilgrims.length } },
  });

  const hajjInvoice = await prisma.invoice.create({
    data: {
      invoiceNumber: ref('INV'),
      customerId: aminaIdentity.customer!.id,
      hajjRegistrationId: hajjRegistration.id,
      status: InvoiceStatus.PARTIALLY_PAID,
      currency: hajjStandard.currency,
      totalAmount: hajjTotal,
      issuedByStaffId: agentIdentity.staff!.id,
      lineItems: {
        create: hajjPilgrims.map((pilgrim) => ({
          description: `Hajj package ${hajjStandard.name} (${hajjRegistration.registrationNumber}) — ${pilgrim.firstName} ${pilgrim.lastName}`,
          amount: hajjStandard.price,
        })),
      },
      payments: {
        create: [
          {
            paymentReference: ref('PAY'),
            amount: 3_000_000,
            method: PaymentMethod.BANK_TRANSFER,
            note: 'First installment — bank transfer',
            recordedByStaffId: financeIdentity.staff!.id,
          },
        ],
      },
    },
  });
  console.log(
    `Created Hajj registration ${hajjRegistration.registrationNumber} for Amina Yusuf's family: ₦3,000,000 of ₦${hajjTotal.toLocaleString()} paid`,
  );

  // --- Umrah registration for Chinedu, staff-assisted (demonstrates incentive) ---
  const umrahPilgrims = [
    {
      customerId: chineduIdentity.customer!.id,
      familyMemberId: null,
      firstName: 'Chinedu',
      lastName: 'Okafor',
      passportNumber: 'A00200201',
    },
  ];
  const umrahTotal = umrahEconomy.sellingPrice * umrahPilgrims.length;

  const umrahRegistration = await prisma.umrahRegistration.create({
    data: {
      registrationNumber: ref('UMRAH'),
      packageId: umrahEconomy.id,
      customerId: chineduIdentity.customer!.id,
      registeredByStaffId: agentIdentity.staff!.id,
      status: RegistrationStatus.CONFIRMED,
      currency: umrahEconomy.currency,
      totalAmount: umrahTotal,
      pilgrims: { create: umrahPilgrims },
    },
  });
  await prisma.umrahPackage.update({
    where: { id: umrahEconomy.id },
    data: { seatsAvailable: { decrement: umrahPilgrims.length } },
  });

  const umrahPaymentAmount = umrahTotal;
  const umrahInvoice = await prisma.invoice.create({
    data: {
      invoiceNumber: ref('INV'),
      customerId: chineduIdentity.customer!.id,
      umrahRegistrationId: umrahRegistration.id,
      status: InvoiceStatus.PAID,
      currency: umrahEconomy.currency,
      totalAmount: umrahTotal,
      issuedByStaffId: agentIdentity.staff!.id,
      lineItems: {
        create: umrahPilgrims.map((pilgrim) => ({
          description: `Umrah package ${umrahEconomy.name} (${umrahRegistration.registrationNumber}) — ${pilgrim.firstName} ${pilgrim.lastName}`,
          amount: umrahEconomy.sellingPrice,
        })),
      },
      payments: {
        create: [
          {
            paymentReference: ref('PAY'),
            amount: umrahPaymentAmount,
            method: PaymentMethod.CARD,
            note: 'Paid in full at the branch',
            recordedByStaffId: financeIdentity.staff!.id,
          },
        ],
      },
    },
  });
  const incentivePercent = (umrahEconomy.incentiveRule as { percent: number })
    .percent;
  await prisma.staffIncentive.create({
    data: {
      staffId: agentIdentity.staff!.id,
      sourceType: 'UMRAH_REGISTRATION',
      sourceId: umrahRegistration.id,
      amount: Math.round((umrahPaymentAmount * incentivePercent) / 100),
      currency: umrahEconomy.currency,
      description: `${incentivePercent}% incentive on ₦${umrahPaymentAmount.toLocaleString()} payment for ${umrahRegistration.registrationNumber}`,
    },
  });
  console.log(
    `Created Umrah registration ${umrahRegistration.registrationNumber} for Chinedu Okafor — paid in full, staff incentive recorded`,
  );

  // --- Wallet activity for Amina --------------------------------------
  const aminaWallet = await prisma.wallet.create({
    data: { customerId: aminaIdentity.customer!.id },
  });
  await prisma.walletTransaction.create({
    data: {
      walletId: aminaWallet.id,
      type: WalletTransactionType.DEPOSIT,
      status: WalletTransactionStatus.COMPLETED,
      amount: 200_000,
      currency: 'NGN',
      description: 'Manual wallet credit — cash deposit at branch',
      reference: ref('WMDEP'),
      createdByStaffId: financeIdentity.staff!.id,
    },
  });
  await prisma.walletTransaction.create({
    data: {
      walletId: aminaWallet.id,
      type: WalletTransactionType.ADJUSTMENT,
      status: WalletTransactionStatus.COMPLETED,
      amount: -50_000,
      currency: 'NGN',
      description: 'Correction — duplicate deposit reversal',
      reference: ref('WADJ'),
      createdByStaffId: financeIdentity.staff!.id,
    },
  });
  console.log('Created wallet activity for Amina Yusuf: ₦150,000 net balance');

  // --- A manual payment submission awaiting finance review ---------------
  await prisma.manualPaymentSubmission.create({
    data: {
      invoiceId: hajjInvoice.id,
      customerId: aminaIdentity.customer!.id,
      amount: 1_000_000,
      method: PaymentMethod.BANK_TRANSFER,
      bankName: 'Demo Bank Nigeria',
      transactionReference: 'DEMO-TRX-778812',
      description: 'Second Hajj installment — awaiting verification',
      submittedByStaffId: agentIdentity.staff!.id,
      status: ManualPaymentStatus.PENDING_VERIFICATION,
    },
  });
  console.log('Created a manual payment submission awaiting Finance review');

  // --- In-app notifications for Amina -----------------------------------
  await prisma.notification.createMany({
    data: [
      {
        type: NotificationType.WALLET_DEPOSIT,
        recipient: aminaIdentity.email,
        subject: 'Wallet credited: NGN 200,000',
        body: 'Your wallet was credited with ₦200,000 (cash deposit at branch).',
        status: NotificationStatus.SENT,
        identityId: aminaIdentity.id,
      },
      {
        type: NotificationType.INSTALLMENT_REMINDER,
        recipient: aminaIdentity.email,
        subject: `Installment reminder: ${hajjRegistration.registrationNumber}`,
        body: `Package: ${hajjStandard.name}\nRemaining balance: NGN ${(hajjTotal - 3_000_000).toLocaleString()}`,
        status: NotificationStatus.SENT,
        identityId: aminaIdentity.id,
      },
    ],
  });
  console.log('Created in-app notifications for Amina Yusuf');

  console.log('--------------------------------------------------------');
  console.log(
    'Phase 1/2 demo data seeded successfully. Demo logins (password for all: Demo@2026):',
  );
  console.log(`  Customer:        ${aminaIdentity.email}`);
  console.log(`  Customer (VIP):  ${chineduIdentity.email}`);
  console.log(`  Staff (agent):   ${agentIdentity.email}`);
  console.log(`  Staff (finance): ${financeIdentity.email}`);
  console.log('--------------------------------------------------------');
}

/**
 * Phase 3 demo data: visa services, guarantors, applications across 9
 * statuses, documents, incentives, and payouts. Independently idempotent
 * from seedPhase1And2 (gated on a VisaService already existing, not on the
 * MARKER_EMAIL check) — this can run additively even after Phase 1/2 demo
 * data already exists from an earlier invocation, no full reset required.
 * Depends on the Phase 1/2 demo staff/customers/family already existing —
 * re-fetches them by their known demo identifiers rather than sharing
 * in-memory references, so it works correctly whether Phase 1/2 just ran
 * in this same process or ran previously.
 */
async function seedPhase3Visa() {
  const alreadySeeded = await prisma.visaService.findFirst();
  if (alreadySeeded) {
    console.log('Phase 3 demo data already present — skipping');
    return;
  }

  const agentIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: 'fatima.sule@demo.alnajoum.travel' },
    include: { staff: true },
  });
  const financeIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: 'ibrahim.musa@demo.alnajoum.travel' },
    include: { staff: true },
  });
  const aminaIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: MARKER_EMAIL },
    include: { customer: true },
  });
  const chineduIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: 'chinedu.okafor@demo.alnajoum.travel' },
    include: { customer: true },
  });
  const spouse = await prisma.familyMember.findFirstOrThrow({
    where: { customerId: aminaIdentity.customer!.id, relationship: 'SPOUSE' },
  });
  const child1 = await prisma.familyMember.findFirstOrThrow({
    where: { customerId: aminaIdentity.customer!.id, firstName: 'Zainab' },
  });

  // Bank details for the demo agent, so a payout can actually be attempted
  // against them (fictional account — see the module doc comment above).
  await prisma.staff.update({
    where: { id: agentIdentity.staff!.id },
    data: {
      bankName: 'Demo Bank Nigeria',
      bankAccountNumber: '0198765432',
      bankAccountName: 'Fatima Sule',
    },
  });

  const standardPolicy = await prisma.incentivePolicy.create({
    data: {
      name: 'Standard Visa Incentive',
      type: IncentivePolicyType.PERCENT_OF_MARGIN,
      config: { percent: 50 },
      isDefault: true,
    },
  });
  const fullMarginPolicy = await prisma.incentivePolicy.create({
    data: {
      name: 'Full Margin Bonus',
      type: IncentivePolicyType.FULL_MARGIN,
      config: {},
    },
  });
  console.log(
    'Created 2 incentive policies (Standard 50% — platform default, and Full Margin Bonus)',
  );

  const svSaudiPilgrimage = await prisma.visaService.create({
    data: {
      serviceCode: ref('VS'),
      country: 'Saudi Arabia',
      visaType: 'Pilgrimage',
      visaCategory: 'Umrah',
      description:
        'Umrah pilgrimage visa, processed through our licensed Saudi partner.',
      processingTime: '10-15 business days',
      validityPeriod: '90 days, single entry',
      entryType: 'Single',
      requiredDocuments:
        'Passport (6+ months validity), passport photo, vaccination certificate',
      supplierName: 'Al Rajhi Visa Services',
      supplierCost: 550_000,
      companyCost: 600_000, // matches the spec's own worked example exactly
      sellingPrice: 800_000,
      currency: 'NGN',
      processingFee: 5_000,
      requiresGuarantor: true,
      incentivePolicyId: standardPolicy.id,
      status: VisaServiceStatus.ACTIVE,
    },
  });
  const svUkTourist = await prisma.visaService.create({
    data: {
      serviceCode: ref('VS'),
      country: 'United Kingdom',
      visaType: 'Tourist',
      visaCategory: 'Standard Visitor',
      description: 'UK standard visitor visa for tourism or family visits.',
      processingTime: '15-20 business days',
      validityPeriod: '6 months',
      entryType: 'Multiple',
      requiredDocuments:
        'Passport, bank statement, proof of accommodation, invitation letter (if applicable)',
      supplierCost: 300_000,
      companyCost: 350_000,
      sellingPrice: 480_000,
      currency: 'NGN',
      processingFee: 10_000,
      requiresGuarantor: true,
      incentivePolicyId: fullMarginPolicy.id,
      status: VisaServiceStatus.ACTIVE,
    },
  });
  const svCanadaStudent = await prisma.visaService.create({
    data: {
      serviceCode: ref('VS'),
      country: 'Canada',
      visaType: 'Student',
      visaCategory: 'Study Permit',
      description: 'Canadian study permit application support.',
      processingTime: '4-8 weeks',
      validityPeriod: 'Duration of study program',
      entryType: 'Multiple',
      requiredDocuments:
        'Passport, admission letter, proof of funds, medical exam',
      companyCost: 250_000,
      sellingPrice: 350_000,
      currency: 'NGN',
      processingFee: 15_000,
      requiresGuarantor: false, // business decision: study-permit applicants are exempt by default
      status: VisaServiceStatus.ACTIVE,
      // No incentivePolicyId set deliberately — this service relies on the
      // platform default policy (standardPolicy, isDefault: true) to
      // demonstrate the fallback path.
    },
  });
  await prisma.visaService.create({
    data: {
      serviceCode: ref('VS'),
      country: 'United Arab Emirates',
      visaType: 'Business',
      description: 'UAE business visa — still being configured.',
      companyCost: 150_000,
      sellingPrice: 220_000,
      currency: 'NGN',
      requiresGuarantor: false,
      status: VisaServiceStatus.DRAFT,
    },
  });
  await prisma.visaService.create({
    data: {
      serviceCode: ref('VS'),
      country: 'United States',
      visaType: 'Tourist',
      visaCategory: 'B1/B2',
      description:
        'US tourist visa — temporarily suspended pending embassy schedule changes.',
      companyCost: 400_000,
      sellingPrice: 400_000, // zero margin on purpose — a realistic "break-even, do not sell yet" state
      currency: 'NGN',
      requiresGuarantor: true,
      status: VisaServiceStatus.SUSPENDED,
    },
  });
  console.log(
    'Created 5 visa services (Saudi Pilgrimage, UK Tourist, Canada Student, UAE Business [draft], US Tourist [suspended])',
  );

  // Helper matching VisaService.submit()'s pricing/snapshot logic, since
  // this script writes directly via Prisma rather than going through the
  // API/service layer (same reasoning as every other section above).
  function visaTotal(sv: {
    sellingPrice: number;
    processingFee: number;
    otherFees: number;
  }) {
    return sv.sellingPrice + sv.processingFee + sv.otherFees;
  }

  // 1) Amina — Saudi Pilgrimage, just submitted, still needs a guarantor.
  const visaApp1 = await prisma.visaApplication.create({
    data: {
      applicationReference: `VISA-${new Date().getFullYear()}-000001`,
      customerId: aminaIdentity.customer!.id,
      destinationCountry: svSaudiPilgrimage.country,
      visaType: VisaType.PILGRIMAGE,
      applicantFirstName: 'Amina',
      applicantLastName: 'Yusuf',
      applicantPassportNumber: 'A00100101',
      status: VisaApplicationStatus.AWAITING_GUARANTOR,
      currency: svSaudiPilgrimage.currency,
      totalAmount: visaTotal(svSaudiPilgrimage),
      visaServiceId: svSaudiPilgrimage.id,
      companyCostSnapshot: svSaudiPilgrimage.companyCost,
      sellingPriceSnapshot: svSaudiPilgrimage.sellingPrice,
      guarantorRequired: true,
    },
  });
  await prisma.invoice.create({
    data: {
      invoiceNumber: ref('INV'),
      customerId: aminaIdentity.customer!.id,
      visaApplicationId: visaApp1.id,
      status: InvoiceStatus.ISSUED,
      currency: visaApp1.currency,
      totalAmount: visaApp1.totalAmount,
      lineItems: {
        create: [
          {
            description: `Pilgrimage visa processing (${visaApp1.applicationReference}) — Saudi Arabia, Amina Yusuf`,
            amount: visaApp1.totalAmount,
          },
        ],
      },
    },
  });

  // 2) Amina's spouse — UK Tourist, guarantor attached but not yet verified.
  const guarantor2 = await prisma.guarantor.create({
    data: {
      fullName: 'Amina Yusuf',
      phone: '+2348000000101',
      email: MARKER_EMAIL,
      relationship: 'Spouse',
      idType: 'National ID',
      idNumber: 'NIN-10010001',
      verificationStatus: VerificationStatus.PENDING,
      approvalStatus: ApprovalStatus.PENDING,
    },
  });
  const visaApp2 = await prisma.visaApplication.create({
    data: {
      applicationReference: `VISA-${new Date().getFullYear()}-000002`,
      customerId: aminaIdentity.customer!.id,
      familyMemberId: spouse.id,
      destinationCountry: svUkTourist.country,
      visaType: VisaType.TOURIST,
      applicantFirstName: spouse.firstName,
      applicantLastName: spouse.lastName,
      applicantPassportNumber: spouse.passportNumber,
      status: VisaApplicationStatus.GUARANTOR_VERIFICATION,
      currency: svUkTourist.currency,
      totalAmount: visaTotal(svUkTourist),
      visaServiceId: svUkTourist.id,
      companyCostSnapshot: svUkTourist.companyCost,
      sellingPriceSnapshot: svUkTourist.sellingPrice,
      guarantorRequired: true,
      guarantorId: guarantor2.id,
      contactPhone: '+2348000000102',
    },
  });
  await prisma.invoice.create({
    data: {
      invoiceNumber: ref('INV'),
      customerId: aminaIdentity.customer!.id,
      visaApplicationId: visaApp2.id,
      status: InvoiceStatus.ISSUED,
      currency: visaApp2.currency,
      totalAmount: visaApp2.totalAmount,
      lineItems: {
        create: [
          {
            description: `Tourist visa processing (${visaApp2.applicationReference}) — United Kingdom, ${spouse.firstName} ${spouse.lastName}`,
            amount: visaApp2.totalAmount,
          },
        ],
      },
    },
  });
  await prisma.visaDocument.create({
    data: {
      applicationId: visaApp2.id,
      type: DocumentType.PASSPORT,
      originalFileName: 'yusuf-abdullahi-passport.jpg',
      storedFileName: ref('seed-doc') + '.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 482_113,
      status: VisaDocumentStatus.PENDING_REVIEW,
    },
  });

  // 3) Chinedu — UK Tourist, guarantor exempted by staff, awaiting payment.
  const visaApp3 = await prisma.visaApplication.create({
    data: {
      applicationReference: `VISA-${new Date().getFullYear()}-000003`,
      customerId: chineduIdentity.customer!.id,
      destinationCountry: svUkTourist.country,
      visaType: VisaType.TOURIST,
      applicantFirstName: 'Chinedu',
      applicantLastName: 'Okafor',
      applicantPassportNumber: 'A00200201',
      status: VisaApplicationStatus.PAYMENT_PENDING,
      currency: svUkTourist.currency,
      totalAmount: visaTotal(svUkTourist),
      visaServiceId: svUkTourist.id,
      companyCostSnapshot: svUkTourist.companyCost,
      sellingPriceSnapshot: svUkTourist.sellingPrice,
      guarantorRequired: true,
      guarantorExempt: true,
      guarantorExemptReason:
        'Long-standing VIP client, waived by branch manager',
      appliedByStaffId: agentIdentity.staff!.id,
    },
  });
  await prisma.invoice.create({
    data: {
      invoiceNumber: ref('INV'),
      customerId: chineduIdentity.customer!.id,
      visaApplicationId: visaApp3.id,
      status: InvoiceStatus.ISSUED,
      currency: visaApp3.currency,
      totalAmount: visaApp3.totalAmount,
      issuedByStaffId: agentIdentity.staff!.id,
      lineItems: {
        create: [
          {
            description: `Tourist visa processing (${visaApp3.applicationReference}) — United Kingdom, Chinedu Okafor`,
            amount: visaApp3.totalAmount,
          },
        ],
      },
    },
  });

  // 4) Chinedu — Canada Student, fully paid, under staff review, with an internal note.
  const visaApp4 = await prisma.visaApplication.create({
    data: {
      applicationReference: `VISA-${new Date().getFullYear()}-000004`,
      customerId: chineduIdentity.customer!.id,
      destinationCountry: svCanadaStudent.country,
      visaType: VisaType.STUDENT,
      applicantFirstName: 'Chinedu',
      applicantLastName: 'Okafor',
      applicantPassportNumber: 'A00200201',
      status: VisaApplicationStatus.UNDER_REVIEW,
      currency: svCanadaStudent.currency,
      totalAmount: visaTotal(svCanadaStudent),
      visaServiceId: svCanadaStudent.id,
      companyCostSnapshot: svCanadaStudent.companyCost,
      sellingPriceSnapshot: svCanadaStudent.sellingPrice,
      guarantorRequired: false,
      assignedStaffId: agentIdentity.staff!.id,
    },
  });
  await prisma.invoice.create({
    data: {
      invoiceNumber: ref('INV'),
      customerId: chineduIdentity.customer!.id,
      visaApplicationId: visaApp4.id,
      status: InvoiceStatus.PAID,
      currency: visaApp4.currency,
      totalAmount: visaApp4.totalAmount,
      payments: {
        create: [
          {
            paymentReference: ref('PAY'),
            amount: visaApp4.totalAmount,
            method: PaymentMethod.CARD,
            recordedByStaffId: financeIdentity.staff!.id,
          },
        ],
      },
      lineItems: {
        create: [
          {
            description: `Student visa processing (${visaApp4.applicationReference}) — Canada, Chinedu Okafor`,
            amount: visaApp4.totalAmount,
          },
        ],
      },
    },
  });
  await prisma.visaApplicationNote.create({
    data: {
      applicationId: visaApp4.id,
      staffId: agentIdentity.staff!.id,
      note: 'Admission letter confirmed with the university directly — proceeding to embassy submission.',
    },
  });

  // 5) Amina — Saudi Pilgrimage, guarantor approved, now processing.
  const guarantor5 = await prisma.guarantor.create({
    data: {
      fullName: 'Yusuf Abdullahi',
      phone: '+2348000000102',
      relationship: 'Spouse',
      idType: 'International Passport',
      idNumber: 'A00100102',
      verificationStatus: VerificationStatus.VERIFIED,
      approvalStatus: ApprovalStatus.APPROVED,
      acceptedResponsibilityAt: new Date(),
      verifiedByStaffId: agentIdentity.staff!.id,
      verificationNote: 'Confirmed by phone and ID document.',
    },
  });
  const visaApp5 = await prisma.visaApplication.create({
    data: {
      applicationReference: `VISA-${new Date().getFullYear()}-000005`,
      customerId: aminaIdentity.customer!.id,
      destinationCountry: svSaudiPilgrimage.country,
      visaType: VisaType.PILGRIMAGE,
      applicantFirstName: 'Amina',
      applicantLastName: 'Yusuf',
      applicantPassportNumber: 'A00100101',
      status: VisaApplicationStatus.PROCESSING,
      currency: svSaudiPilgrimage.currency,
      totalAmount: visaTotal(svSaudiPilgrimage),
      visaServiceId: svSaudiPilgrimage.id,
      companyCostSnapshot: svSaudiPilgrimage.companyCost,
      sellingPriceSnapshot: svSaudiPilgrimage.sellingPrice,
      guarantorRequired: true,
      guarantorId: guarantor5.id,
      assignedStaffId: agentIdentity.staff!.id,
    },
  });
  await prisma.invoice.create({
    data: {
      invoiceNumber: ref('INV'),
      customerId: aminaIdentity.customer!.id,
      visaApplicationId: visaApp5.id,
      status: InvoiceStatus.PAID,
      currency: visaApp5.currency,
      totalAmount: visaApp5.totalAmount,
      payments: {
        create: [
          {
            paymentReference: ref('PAY'),
            amount: visaApp5.totalAmount,
            method: PaymentMethod.BANK_TRANSFER,
            recordedByStaffId: financeIdentity.staff!.id,
          },
        ],
      },
      lineItems: {
        create: [
          {
            description: `Pilgrimage visa processing (${visaApp5.applicationReference}) — Saudi Arabia, Amina Yusuf`,
            amount: visaApp5.totalAmount,
          },
        ],
      },
    },
  });

  // 6) Amina — Saudi Pilgrimage, COMPLETED — the spec's own worked example
  // end to end: company cost ₦600,000, selling price ₦800,000, margin
  // ₦200,000, Standard 50% policy -> ₦100,000 incentive, still PENDING approval.
  const visaApp6 = await prisma.visaApplication.create({
    data: {
      applicationReference: `VISA-${new Date().getFullYear()}-000006`,
      customerId: aminaIdentity.customer!.id,
      destinationCountry: svSaudiPilgrimage.country,
      visaType: VisaType.PILGRIMAGE,
      applicantFirstName: 'Amina',
      applicantLastName: 'Yusuf',
      applicantPassportNumber: 'A00100101',
      status: VisaApplicationStatus.COMPLETED,
      currency: svSaudiPilgrimage.currency,
      totalAmount: visaTotal(svSaudiPilgrimage),
      visaServiceId: svSaudiPilgrimage.id,
      companyCostSnapshot: svSaudiPilgrimage.companyCost,
      sellingPriceSnapshot: svSaudiPilgrimage.sellingPrice,
      guarantorRequired: true,
      assignedStaffId: agentIdentity.staff!.id,
    },
  });
  await prisma.invoice.create({
    data: {
      invoiceNumber: ref('INV'),
      customerId: aminaIdentity.customer!.id,
      visaApplicationId: visaApp6.id,
      status: InvoiceStatus.PAID,
      currency: visaApp6.currency,
      totalAmount: visaApp6.totalAmount,
      payments: {
        create: [
          {
            paymentReference: ref('PAY'),
            amount: visaApp6.totalAmount,
            method: PaymentMethod.BANK_TRANSFER,
            recordedByStaffId: financeIdentity.staff!.id,
          },
        ],
      },
      lineItems: {
        create: [
          {
            description: `Pilgrimage visa processing (${visaApp6.applicationReference}) — Saudi Arabia, Amina Yusuf`,
            amount: visaApp6.totalAmount,
          },
        ],
      },
    },
  });
  const margin6 =
    svSaudiPilgrimage.sellingPrice - svSaudiPilgrimage.companyCost;
  await prisma.staffIncentive.create({
    data: {
      staffId: agentIdentity.staff!.id,
      sourceType: 'VISA_APPLICATION',
      sourceId: visaApp6.id,
      amount: Math.round((margin6 * 50) / 100),
      currency: visaApp6.currency,
      description: `Incentive on visa application ${visaApp6.applicationReference}`,
      status: IncentiveStatus.PENDING,
      referenceNumber: ref('INC'),
      companyCost: svSaudiPilgrimage.companyCost,
      sellingPrice: svSaudiPilgrimage.sellingPrice,
      margin: margin6,
      policyId: standardPolicy.id,
      customerId: aminaIdentity.customer!.id,
    },
  });

  // 7) Chinedu — UK Tourist, COMPLETED, incentive already APPROVED by
  // Finance, awaiting payout.
  const visaApp7 = await prisma.visaApplication.create({
    data: {
      applicationReference: `VISA-${new Date().getFullYear()}-000007`,
      customerId: chineduIdentity.customer!.id,
      destinationCountry: svUkTourist.country,
      visaType: VisaType.TOURIST,
      applicantFirstName: 'Chinedu',
      applicantLastName: 'Okafor',
      applicantPassportNumber: 'A00200201',
      status: VisaApplicationStatus.COMPLETED,
      currency: svUkTourist.currency,
      totalAmount: visaTotal(svUkTourist),
      visaServiceId: svUkTourist.id,
      companyCostSnapshot: svUkTourist.companyCost,
      sellingPriceSnapshot: svUkTourist.sellingPrice,
      guarantorRequired: true,
      guarantorExempt: true,
      guarantorExemptReason:
        'Repeat customer, previously approved guarantor on file',
      assignedStaffId: agentIdentity.staff!.id,
    },
  });
  await prisma.invoice.create({
    data: {
      invoiceNumber: ref('INV'),
      customerId: chineduIdentity.customer!.id,
      visaApplicationId: visaApp7.id,
      status: InvoiceStatus.PAID,
      currency: visaApp7.currency,
      totalAmount: visaApp7.totalAmount,
      payments: {
        create: [
          {
            paymentReference: ref('PAY'),
            amount: visaApp7.totalAmount,
            method: PaymentMethod.CARD,
            recordedByStaffId: financeIdentity.staff!.id,
          },
        ],
      },
      lineItems: {
        create: [
          {
            description: `Tourist visa processing (${visaApp7.applicationReference}) — United Kingdom, Chinedu Okafor`,
            amount: visaApp7.totalAmount,
          },
        ],
      },
    },
  });
  const margin7 = svUkTourist.sellingPrice - svUkTourist.companyCost;
  await prisma.staffIncentive.create({
    data: {
      staffId: agentIdentity.staff!.id,
      sourceType: 'VISA_APPLICATION',
      sourceId: visaApp7.id,
      amount: margin7, // FULL_MARGIN policy
      currency: visaApp7.currency,
      description: `Incentive on visa application ${visaApp7.applicationReference}`,
      status: IncentiveStatus.APPROVED,
      referenceNumber: ref('INC'),
      companyCost: svUkTourist.companyCost,
      sellingPrice: svUkTourist.sellingPrice,
      margin: margin7,
      policyId: fullMarginPolicy.id,
      customerId: chineduIdentity.customer!.id,
      approvedByStaffId: financeIdentity.staff!.id,
      approvedAt: new Date(),
    },
  });

  // 8) Amina — a second completed Saudi Pilgrimage, incentive PAID out via
  // a successful mock payout — demonstrates the full payable lifecycle.
  const visaApp8 = await prisma.visaApplication.create({
    data: {
      applicationReference: `VISA-${new Date().getFullYear()}-000008`,
      customerId: aminaIdentity.customer!.id,
      familyMemberId: child1.id,
      destinationCountry: svSaudiPilgrimage.country,
      visaType: VisaType.PILGRIMAGE,
      applicantFirstName: child1.firstName,
      applicantLastName: child1.lastName,
      applicantPassportNumber: child1.passportNumber,
      status: VisaApplicationStatus.COMPLETED,
      currency: svSaudiPilgrimage.currency,
      totalAmount: visaTotal(svSaudiPilgrimage),
      visaServiceId: svSaudiPilgrimage.id,
      companyCostSnapshot: svSaudiPilgrimage.companyCost,
      sellingPriceSnapshot: svSaudiPilgrimage.sellingPrice,
      guarantorRequired: true,
      guarantorExempt: true,
      guarantorExemptReason:
        'Minor traveling with a parent already on file as guarantor',
      assignedStaffId: agentIdentity.staff!.id,
    },
  });
  await prisma.invoice.create({
    data: {
      invoiceNumber: ref('INV'),
      customerId: aminaIdentity.customer!.id,
      visaApplicationId: visaApp8.id,
      status: InvoiceStatus.PAID,
      currency: visaApp8.currency,
      totalAmount: visaApp8.totalAmount,
      payments: {
        create: [
          {
            paymentReference: ref('PAY'),
            amount: visaApp8.totalAmount,
            method: PaymentMethod.WALLET,
            recordedByStaffId: financeIdentity.staff!.id,
          },
        ],
      },
      lineItems: {
        create: [
          {
            description: `Pilgrimage visa processing (${visaApp8.applicationReference}) — Saudi Arabia, ${child1.firstName} ${child1.lastName}`,
            amount: visaApp8.totalAmount,
          },
        ],
      },
    },
  });
  const margin8 =
    svSaudiPilgrimage.sellingPrice - svSaudiPilgrimage.companyCost;
  const incentive8 = await prisma.staffIncentive.create({
    data: {
      staffId: agentIdentity.staff!.id,
      sourceType: 'VISA_APPLICATION',
      sourceId: visaApp8.id,
      amount: Math.round((margin8 * 50) / 100),
      currency: visaApp8.currency,
      description: `Incentive on visa application ${visaApp8.applicationReference}`,
      status: IncentiveStatus.PAID,
      referenceNumber: ref('INC'),
      companyCost: svSaudiPilgrimage.companyCost,
      sellingPrice: svSaudiPilgrimage.sellingPrice,
      margin: margin8,
      policyId: standardPolicy.id,
      customerId: aminaIdentity.customer!.id,
      approvedByStaffId: financeIdentity.staff!.id,
      approvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.staffPayout.create({
    data: {
      incentiveId: incentive8.id,
      staffId: agentIdentity.staff!.id,
      amount: incentive8.amount,
      currency: incentive8.currency,
      status: PayoutStatus.SUCCESSFUL,
      provider: 'mock',
      providerReference: `MOCKPAY-${randomBytes(4).toString('hex').toUpperCase()}`,
      requestedByStaffId: financeIdentity.staff!.id,
    },
  });

  // 9) An offline/manual transaction, processed by phone — completed, with
  // its own PENDING incentive requiring approval like any other (see the
  // module doc comment: manual transactions never skip approval).
  const visaApp9 = await prisma.visaApplication.create({
    data: {
      applicationReference: `VISA-${new Date().getFullYear()}-000009`,
      customerId: chineduIdentity.customer!.id,
      destinationCountry: svSaudiPilgrimage.country,
      visaType: VisaType.PILGRIMAGE,
      applicantFirstName: 'Chinedu',
      applicantLastName: 'Okafor',
      applicantPassportNumber: 'A00200201',
      status: VisaApplicationStatus.COMPLETED,
      currency: svSaudiPilgrimage.currency,
      totalAmount: visaTotal(svSaudiPilgrimage),
      visaServiceId: svSaudiPilgrimage.id,
      companyCostSnapshot: svSaudiPilgrimage.companyCost,
      sellingPriceSnapshot: svSaudiPilgrimage.sellingPrice,
      guarantorRequired: true,
      guarantorExempt: true,
      guarantorExemptReason: 'Processed entirely offline — see offlineReason',
      isOfflineEntry: true,
      offlineReason:
        'Customer called in and paid cash at the branch; processed by phone, no portal submission.',
      appliedByStaffId: agentIdentity.staff!.id,
      assignedStaffId: agentIdentity.staff!.id,
    },
  });
  await prisma.invoice.create({
    data: {
      invoiceNumber: ref('INV'),
      customerId: chineduIdentity.customer!.id,
      visaApplicationId: visaApp9.id,
      status: InvoiceStatus.PAID,
      currency: visaApp9.currency,
      totalAmount: visaApp9.totalAmount,
      issuedByStaffId: agentIdentity.staff!.id,
      payments: {
        create: [
          {
            paymentReference: ref('PAY'),
            amount: visaApp9.totalAmount,
            method: PaymentMethod.CASH,
            note: 'Cash at branch — offline entry',
            recordedByStaffId: financeIdentity.staff!.id,
          },
        ],
      },
      lineItems: {
        create: [
          {
            description: `Pilgrimage visa processing (${visaApp9.applicationReference}) — Saudi Arabia, Chinedu Okafor [OFFLINE]`,
            amount: visaApp9.totalAmount,
          },
        ],
      },
    },
  });
  const margin9 =
    svSaudiPilgrimage.sellingPrice - svSaudiPilgrimage.companyCost;
  const incentive9 = await prisma.staffIncentive.create({
    data: {
      staffId: agentIdentity.staff!.id,
      sourceType: 'VISA_APPLICATION',
      sourceId: visaApp9.id,
      amount: Math.round((margin9 * 50) / 100),
      currency: visaApp9.currency,
      description: `Incentive on visa application ${visaApp9.applicationReference} (offline transaction)`,
      status: IncentiveStatus.APPROVED,
      referenceNumber: ref('INC'),
      companyCost: svSaudiPilgrimage.companyCost,
      sellingPrice: svSaudiPilgrimage.sellingPrice,
      margin: margin9,
      policyId: standardPolicy.id,
      customerId: chineduIdentity.customer!.id,
      approvedByStaffId: financeIdentity.staff!.id,
      approvedAt: new Date(),
    },
  });
  await prisma.staffPayout.create({
    data: {
      incentiveId: incentive9.id,
      staffId: agentIdentity.staff!.id,
      amount: incentive9.amount,
      currency: incentive9.currency,
      status: PayoutStatus.FAILED,
      provider: 'mock',
      providerError:
        'Bank rejected the transfer: account number could not be verified',
      requestedByStaffId: financeIdentity.staff!.id,
    },
  });

  // 10) Amina — Canada Student, REJECTED (insufficient funds).
  await prisma.visaApplication.create({
    data: {
      applicationReference: `VISA-${new Date().getFullYear()}-000010`,
      customerId: aminaIdentity.customer!.id,
      familyMemberId: child1.id,
      destinationCountry: svCanadaStudent.country,
      visaType: VisaType.STUDENT,
      applicantFirstName: child1.firstName,
      applicantLastName: child1.lastName,
      applicantPassportNumber: child1.passportNumber,
      status: VisaApplicationStatus.REJECTED,
      staffNote:
        'Insufficient proof of funds to support the full duration of study.',
      currency: svCanadaStudent.currency,
      totalAmount: visaTotal(svCanadaStudent),
      visaServiceId: svCanadaStudent.id,
      companyCostSnapshot: svCanadaStudent.companyCost,
      sellingPriceSnapshot: svCanadaStudent.sellingPrice,
      guarantorRequired: false,
      assignedStaffId: agentIdentity.staff!.id,
    },
  });

  // 11) Chinedu — cancelled by the customer before payment.
  await prisma.visaApplication.create({
    data: {
      applicationReference: `VISA-${new Date().getFullYear()}-000011`,
      customerId: chineduIdentity.customer!.id,
      destinationCountry: svUkTourist.country,
      visaType: VisaType.TOURIST,
      applicantFirstName: 'Chinedu',
      applicantLastName: 'Okafor',
      applicantPassportNumber: 'A00200201',
      status: VisaApplicationStatus.CANCELLED,
      currency: svUkTourist.currency,
      totalAmount: visaTotal(svUkTourist),
      visaServiceId: svUkTourist.id,
      companyCostSnapshot: svUkTourist.companyCost,
      sellingPriceSnapshot: svUkTourist.sellingPrice,
      guarantorRequired: true,
    },
  });

  console.log(
    'Created 11 visa applications across 9 statuses (AWAITING_GUARANTOR, GUARANTOR_VERIFICATION, ' +
      'PAYMENT_PENDING, UNDER_REVIEW, PROCESSING, COMPLETED x4, REJECTED, CANCELLED), 2 guarantors, ' +
      '1 document, 4 staff incentives (PENDING/APPROVED/PAID/APPROVED) and 2 payouts (SUCCESSFUL/FAILED)',
  );

  console.log('--------------------------------------------------------');
  console.log('Phase 3 visa demo data seeded successfully.');
  console.log(
    '  Visa officer: fatima.sule@demo.alnajoum.travel (has bank details on file)',
  );
  console.log('  Finance:      ibrahim.musa@demo.alnajoum.travel');
  console.log('--------------------------------------------------------');
}

/**
 * Phase 4 demo data — flight pricing rules, bookings across the full
 * PENDING/CONFIRMED/TICKETED/CANCELLED/REFUNDED spread, a reissue history,
 * a group booking, staff incentives earned on ticketed flights, and a
 * handful of provider transaction log rows (mixed MOCK success/failure) so
 * the Flight Reports dashboard has something to show. Independently
 * idempotent (own existence check) and re-fetches Phase 1/2's demo
 * customers/staff by their known identifiers rather than relying on
 * in-process variables, same reasoning as seedPhase3Visa.
 */
async function seedPhase4Flights() {
  const existing = await prisma.flightBooking.findFirst({
    where: { bookingReference: { startsWith: 'ANJ-DEMO' } },
  });
  if (existing) {
    console.log('Phase 4 flight demo data already present — skipping');
    return;
  }

  const aminaIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: MARKER_EMAIL },
    include: { customer: true },
  });
  const chineduIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: 'chinedu.okafor@demo.alnajoum.travel' },
    include: { customer: true },
  });
  const agentIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: 'fatima.sule@demo.alnajoum.travel' },
    include: { staff: true },
  });
  const financeIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: 'ibrahim.musa@demo.alnajoum.travel' },
    include: { staff: true },
  });
  const branch = await prisma.branch.findFirstOrThrow();

  // --- Pricing rules: one global default, one route-specific override ------
  const defaultIncentivePolicy = await prisma.incentivePolicy.findFirst({
    where: { isDefault: true, isActive: true },
  });

  const globalRule = await prisma.flightPricingRule.create({
    data: {
      name: 'Global default markup',
      type: 'PERCENTAGE',
      percent: 5,
      priority: 0,
      isActive: true,
      incentivePolicyId: defaultIncentivePolicy?.id,
    },
  });
  await prisma.flightPricingRule.create({
    data: {
      name: 'Lagos → Dubai promo',
      type: 'FIXED',
      amount: 15_000,
      origin: 'LOS',
      destination: 'DXB',
      priority: 10,
      isPromotional: true,
      isActive: true,
      incentivePolicyId: defaultIncentivePolicy?.id,
    },
  });

  function itinerary(
    origin: string,
    destination: string,
    airline: string,
    airlineCode: string,
    days: number,
    amount: number,
  ) {
    const departureAt = new Date(
      Date.now() + days * 24 * 60 * 60 * 1000,
    ).toISOString();
    return {
      id: ref('offer'),
      provider: 'MOCK',
      tripType: 'ONE_WAY',
      cabinClass: 'ECONOMY',
      currency: 'NGN',
      totalAmount: amount,
      seatsAvailable: 4,
      expiresAt: departureAt,
      legs: [
        {
          origin,
          destination,
          departureAt,
          arrivalAt: departureAt,
          segments: [
            {
              origin,
              destination,
              departureAt,
              arrivalAt: departureAt,
              airline,
              airlineCode,
              flightNumber: `${airlineCode}${100 + days}`,
              cabinClass: 'ECONOMY',
              durationMinutes: 180,
            },
          ],
        },
      ],
      fareConditions: {
        refundable: 'PARTIALLY_REFUNDABLE',
        cancellationPenaltyDescription:
          'Refundable minus a 25% cancellation penalty and non-refundable taxes.',
        baggageAllowance: { checked: '1 x 23kg', cabin: '1 x 7kg' },
        fareBrand: 'Economy Basic',
        warnings: [],
      },
    };
  }

  async function makeBooking(opts: {
    ref: string;
    customerId: string;
    customerFirst: string;
    customerLast: string;
    origin: string;
    destination: string;
    airline: string;
    airlineCode: string;
    days: number;
    providerCost: number;
    markupAmount: number;
    status: 'PENDING' | 'CONFIRMED' | 'TICKETED' | 'CANCELLED' | 'REFUNDED';
    pnr?: string;
    bookedByStaffId?: string;
  }) {
    const totalAmount = opts.providerCost + opts.markupAmount;
    const offer = itinerary(
      opts.origin,
      opts.destination,
      opts.airline,
      opts.airlineCode,
      opts.days,
      totalAmount,
    );
    const booking = await prisma.flightBooking.create({
      data: {
        bookingReference: opts.ref,
        customerId: opts.customerId,
        bookedByStaffId: opts.bookedByStaffId,
        branchId: opts.bookedByStaffId ? branch.id : undefined,
        provider: 'MOCK',
        providerOfferId: offer.id,
        providerOrderId: `MOCK-${ref('order')}`,
        status: opts.status,
        currency: 'NGN',
        totalAmount,
        providerCost: opts.providerCost,
        markupAmount: opts.markupAmount,
        pricingRuleId: globalRule.id,
        tripType: 'ONE_WAY',
        origin: opts.origin,
        destination: opts.destination,
        departureAt: new Date(offer.legs[0].departureAt),
        cabinClass: 'ECONOMY',
        itinerary: offer,
        fareRules: offer.fareConditions,
        refundable: false,
        baggageAllowance: offer.fareConditions.baggageAllowance,
        pnr: opts.pnr,
        ticketedAt:
          opts.status === 'TICKETED' || opts.status === 'REFUNDED'
            ? new Date()
            : undefined,
        ticketedByStaffId:
          opts.status === 'TICKETED' || opts.status === 'REFUNDED'
            ? opts.bookedByStaffId
            : undefined,
        passengers: {
          create: [
            {
              type: 'ADULT',
              customerId: opts.customerId,
              firstName: opts.customerFirst,
              lastName: opts.customerLast,
              ticketNumber: opts.pnr ? `${opts.pnr}-01` : undefined,
            },
          ],
        },
      },
    });

    await prisma.invoice.create({
      data: {
        invoiceNumber: ref('INV'),
        customerId: opts.customerId,
        flightBookingId: booking.id,
        status:
          opts.status === 'PENDING' ? InvoiceStatus.ISSUED : InvoiceStatus.PAID,
        currency: 'NGN',
        totalAmount,
        issuedByStaffId: opts.bookedByStaffId,
        payments:
          opts.status === 'PENDING'
            ? undefined
            : {
                create: [
                  {
                    paymentReference: ref('PAY'),
                    amount: totalAmount,
                    method: PaymentMethod.CARD,
                    recordedByStaffId: financeIdentity.staff!.id,
                  },
                ],
              },
        lineItems: {
          create: [
            {
              description: `Flight ${opts.ref}: ${opts.origin} → ${opts.destination}`,
              amount: totalAmount,
            },
          ],
        },
      },
    });

    return booking;
  }

  // 1) Amina — PENDING (customer self-service, not yet paid).
  await makeBooking({
    ref: 'ANJ-DEMO0001',
    customerId: aminaIdentity.customer!.id,
    customerFirst: 'Amina',
    customerLast: 'Yusuf',
    origin: 'LOS',
    destination: 'ABV',
    airline: 'Air Peace',
    airlineCode: 'P4',
    days: 20,
    providerCost: 65_000,
    markupAmount: 3_250,
    status: 'PENDING',
  });

  // 2) Chinedu — CONFIRMED, paid, awaiting ticket issuance.
  await makeBooking({
    ref: 'ANJ-DEMO0002',
    customerId: chineduIdentity.customer!.id,
    customerFirst: 'Chinedu',
    customerLast: 'Okafor',
    origin: 'LOS',
    destination: 'DXB',
    airline: 'Qatar Airways',
    airlineCode: 'QR',
    days: 30,
    providerCost: 380_000,
    markupAmount: 15_000,
    status: 'CONFIRMED',
    bookedByStaffId: agentIdentity.staff!.id,
  });

  // 3) Amina — TICKETED, booked by staff, earns a staff incentive below.
  const ticketed1 = await makeBooking({
    ref: 'ANJ-DEMO0003',
    customerId: aminaIdentity.customer!.id,
    customerFirst: 'Amina',
    customerLast: 'Yusuf',
    origin: 'ABV',
    destination: 'LHR',
    airline: 'British Airways',
    airlineCode: 'BA',
    days: 45,
    providerCost: 620_000,
    markupAmount: 31_000,
    status: 'TICKETED',
    pnr: 'DEM001',
    bookedByStaffId: agentIdentity.staff!.id,
  });

  // 4) Chinedu — TICKETED, self-service (no staff, no incentive to credit).
  await makeBooking({
    ref: 'ANJ-DEMO0004',
    customerId: chineduIdentity.customer!.id,
    customerFirst: 'Chinedu',
    customerLast: 'Okafor',
    origin: 'LOS',
    destination: 'ADD',
    airline: 'Ethiopian Airlines',
    airlineCode: 'ET',
    days: 10,
    providerCost: 210_000,
    markupAmount: 10_500,
    status: 'TICKETED',
    pnr: 'DEM002',
  });

  // 5) Amina — CANCELLED before ticketing (no refund workflow needed).
  await makeBooking({
    ref: 'ANJ-DEMO0005',
    customerId: aminaIdentity.customer!.id,
    customerFirst: 'Amina',
    customerLast: 'Yusuf',
    origin: 'LOS',
    destination: 'CAI',
    airline: 'Ibom Air',
    airlineCode: 'QI',
    days: 15,
    providerCost: 150_000,
    markupAmount: 7_500,
    status: 'CANCELLED',
  });

  // 6) Chinedu — TICKETED then REFUNDED, with a full FlightRefund record
  // showing the penalty/agency-fee math (never assumes the full price
  // comes back).
  const refundedBooking = await makeBooking({
    ref: 'ANJ-DEMO0006',
    customerId: chineduIdentity.customer!.id,
    customerFirst: 'Chinedu',
    customerLast: 'Okafor',
    origin: 'LOS',
    destination: 'ABV',
    airline: 'Arik Air',
    airlineCode: 'W3',
    days: 5,
    providerCost: 70_000,
    markupAmount: 3_500,
    status: 'REFUNDED',
    pnr: 'DEM003',
    bookedByStaffId: agentIdentity.staff!.id,
  });
  await prisma.flightRefund.create({
    data: {
      bookingId: refundedBooking.id,
      requestedByStaffId: agentIdentity.staff!.id,
      ticketPrice: refundedBooking.totalAmount,
      providerPenalty: Math.round(refundedBooking.totalAmount * 0.25),
      agencyFee: Math.round(refundedBooking.totalAmount * 0.05),
      refundAmount: Math.round(refundedBooking.totalAmount * 0.7),
      currency: 'NGN',
      status: 'COMPLETED',
      reason: 'Customer travel plans changed',
      completedAt: new Date(),
    },
  });

  // 7) Amina — TICKETED, later reissued to a new date/fare — a completed
  // FlightReissue with the full fare-difference/penalty math, so the
  // history is visible even though the booking itself now just shows the
  // new (post-reissue) itinerary.
  const reissuedBooking = await makeBooking({
    ref: 'ANJ-DEMO0007',
    customerId: aminaIdentity.customer!.id,
    customerFirst: 'Amina',
    customerLast: 'Yusuf',
    origin: 'LOS',
    destination: 'JED',
    airline: 'Qatar Airways',
    airlineCode: 'QR',
    days: 60,
    providerCost: 550_000,
    markupAmount: 27_500,
    status: 'TICKETED',
    pnr: 'DEM004',
    bookedByStaffId: agentIdentity.staff!.id,
  });
  const newOffer = itinerary('LOS', 'JED', 'Qatar Airways', 'QR', 65, 605_000);
  await prisma.flightReissue.create({
    data: {
      bookingId: reissuedBooking.id,
      requestedByStaffId: agentIdentity.staff!.id,
      originalOfferSnapshot: reissuedBooking.itinerary as object,
      newOfferSnapshot: newOffer,
      fareDifference: 27_500,
      changePenalty: Math.round(reissuedBooking.totalAmount * 0.03),
      totalDue: 27_500 + Math.round(reissuedBooking.totalAmount * 0.03),
      currency: 'NGN',
      status: 'COMPLETED',
      completedAt: new Date(),
    },
  });

  // --- Staff incentive on the completed ticketed/staff-booked flight -------
  if (defaultIncentivePolicy) {
    const margin = ticketed1.totalAmount - (ticketed1.providerCost ?? 0);
    await prisma.staffIncentive.create({
      data: {
        staffId: agentIdentity.staff!.id,
        sourceType: 'FLIGHT_BOOKING',
        sourceId: ticketed1.id,
        amount: Math.round((margin * 50) / 100),
        currency: 'NGN',
        description: `Incentive on flight booking ${ticketed1.bookingReference}`,
        status: IncentiveStatus.PENDING,
        referenceNumber: ref('INC'),
        companyCost: ticketed1.providerCost,
        sellingPrice: ticketed1.totalAmount,
        margin,
        policyId: defaultIncentivePolicy.id,
        customerId: ticketed1.customerId,
      },
    });
  }

  // --- Group booking: a 12-person Umrah group, part-paid deposit ----------
  const groupInvoice = await prisma.invoice.create({
    data: {
      invoiceNumber: ref('INV'),
      status: InvoiceStatus.PARTIALLY_PAID,
      currency: 'NGN',
      totalAmount: 12 * 750_000,
      issuedByStaffId: agentIdentity.staff!.id,
      payments: {
        create: [
          {
            paymentReference: ref('PAY'),
            amount: 3_000_000,
            method: PaymentMethod.BANK_TRANSFER,
            recordedByStaffId: financeIdentity.staff!.id,
          },
        ],
      },
      lineItems: {
        create: [
          {
            description:
              'Group flight booking: Kaduna Umrah Group 2026 (12 passengers, Jeddah)',
            amount: 12 * 750_000,
          },
        ],
      },
    },
  });
  await prisma.flightGroupBooking.create({
    data: {
      groupReference: ref('GRP'),
      groupName: 'Kaduna Umrah Group 2026',
      groupContactName: 'Fatima Sule',
      groupContactPhone: '+2348000000900',
      groupContactEmail: 'fatima.sule@demo.alnajoum.travel',
      numberOfPassengers: 12,
      origin: 'KAD',
      destination: 'JED',
      travelDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      airline: 'Saudia',
      negotiatedPrice: 12 * 750_000,
      currency: 'NGN',
      deposit: 3_000_000,
      balance: 12 * 750_000 - 3_000_000,
      status: 'CONFIRMED',
      createdByStaffId: agentIdentity.staff!.id,
      branchId: branch.id,
      invoiceId: groupInvoice.id,
      passengers: {
        create: Array.from({ length: 12 }, (_, i) => ({
          firstName: `Pilgrim${i + 1}`,
          lastName: 'Kaduna Group',
        })),
      },
    },
  });

  // --- Provider transaction logs, for the Reports "Provider Success Rate" --
  await prisma.providerTransactionLog.createMany({
    data: [
      {
        provider: 'MOCK',
        operation: 'SEARCH',
        status: 'SUCCESS',
        safeMessage: '4 offer(s) returned',
      },
      {
        provider: 'MOCK',
        operation: 'SEARCH',
        status: 'SUCCESS',
        safeMessage: '3 offer(s) returned',
      },
      {
        provider: 'MOCK',
        operation: 'CREATE_ORDER',
        status: 'SUCCESS',
        safeMessage: 'Order created',
      },
      {
        provider: 'DUFFEL',
        operation: 'SEARCH',
        status: 'FAILURE',
        errorCode: 'INVALID_TOKEN',
        safeMessage: 'Invalid API token',
      },
    ],
  });

  console.log(
    'Created 7 flight bookings (PENDING, CONFIRMED, TICKETED x3, CANCELLED, REFUNDED with reissue history), ' +
      '2 pricing rules, 1 staff incentive, 1 group booking (12 passengers), and 4 provider transaction logs.',
  );

  console.log('--------------------------------------------------------');
  console.log('Phase 4 flight demo data seeded successfully.');
  console.log('--------------------------------------------------------');
}

/**
 * Phase 5 demo data — a small hotel catalog (2 hotels, 4 room types),
 * bookings across PENDING/CONFIRMED/COMPLETED/CANCELLED/REFUNDED (mixing
 * CATALOG-provider and MOCK-provider bookings so the markup/supplierCost
 * snapshot's nullability is exercised both ways), a staff incentive on a
 * completed booking, and one multi-component travel package. Independently
 * idempotent, same pattern as seedPhase3Visa/seedPhase4Flights.
 */
async function seedPhase5Hotels() {
  const existing = await prisma.hotel.findFirst({
    where: { name: 'Alnajoum Demo Grand Hotel' },
  });
  if (existing) {
    console.log('Phase 5 hotel demo data already present — skipping');
    return;
  }

  const aminaIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: MARKER_EMAIL },
    include: { customer: true },
  });
  const chineduIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: 'chinedu.okafor@demo.alnajoum.travel' },
    include: { customer: true },
  });
  const agentIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: 'fatima.sule@demo.alnajoum.travel' },
    include: { staff: true },
  });
  const financeIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: 'ibrahim.musa@demo.alnajoum.travel' },
    include: { staff: true },
  });
  const branch = await prisma.branch.findFirstOrThrow();
  const defaultIncentivePolicy = await prisma.incentivePolicy.findFirst({
    where: { isDefault: true, isActive: true },
  });

  // --- Catalog: 2 hotels, 4 room types --------------------------------------
  const grandHotel = await prisma.hotel.create({
    data: {
      name: 'Alnajoum Demo Grand Hotel',
      description:
        'A fictional 5-star demo hotel in Lagos, for seed data only.',
      country: 'Nigeria',
      city: 'Lagos',
      address: '12 Ahmadu Bello Way, Victoria Island',
      starRating: 5,
      contactPhone: '+2348000000700',
      checkInTime: '14:00',
      checkOutTime: '12:00',
      amenities: [
        'Free WiFi',
        'Pool',
        'Gym',
        'Airport Shuttle',
        'Breakfast Included',
      ],
      images: [],
      cancellationPolicy:
        'Free cancellation up to 2 days before check-in; 25% penalty thereafter.',
      paymentPolicy: 'Full payment required at booking.',
      status: 'ACTIVE',
    },
  });
  const madinahHotel = await prisma.hotel.create({
    data: {
      name: 'Alnajoum Demo Madinah Suites',
      description:
        "A fictional demo hotel near the Prophet's Mosque, for Umrah/Hajj package seed data only.",
      country: 'Saudi Arabia',
      city: 'Madinah',
      address: 'King Fahd Road',
      starRating: 4,
      contactPhone: '+9660000000701',
      checkInTime: '15:00',
      checkOutTime: '12:00',
      amenities: ['Free WiFi', 'Prayer Hall', 'Breakfast Included'],
      images: [],
      cancellationPolicy:
        'Free cancellation up to 7 days before check-in; 30% penalty thereafter.',
      status: 'ACTIVE',
    },
  });

  const doubleRoom = await prisma.hotelRoomType.create({
    data: {
      hotelId: grandHotel.id,
      name: 'Deluxe Double',
      category: 'DOUBLE',
      capacity: 2,
      bedType: 'Queen',
      numberOfBeds: 1,
      mealPlan: 'BED_AND_BREAKFAST',
      supplierCost: 45_000,
      sellingPrice: 60_000,
      currency: 'NGN',
      totalRooms: 10,
      cancellationRules: 'Matches hotel policy.',
    },
  });
  const suiteRoom = await prisma.hotelRoomType.create({
    data: {
      hotelId: grandHotel.id,
      name: 'Executive Suite',
      category: 'SUITE',
      capacity: 3,
      bedType: 'King',
      numberOfBeds: 1,
      mealPlan: 'HALF_BOARD',
      supplierCost: 90_000,
      sellingPrice: 125_000,
      currency: 'NGN',
      totalRooms: 4,
    },
  });
  await prisma.hotelRoomType.create({
    data: {
      hotelId: grandHotel.id,
      name: 'Family Room',
      category: 'FAMILY',
      capacity: 5,
      bedType: 'Mixed',
      numberOfBeds: 3,
      mealPlan: 'BED_AND_BREAKFAST',
      supplierCost: 70_000,
      sellingPrice: 95_000,
      currency: 'NGN',
      totalRooms: 3,
    },
  });
  const madinahDouble = await prisma.hotelRoomType.create({
    data: {
      hotelId: madinahHotel.id,
      name: 'Standard Double',
      category: 'DOUBLE',
      capacity: 2,
      mealPlan: 'FULL_BOARD',
      supplierCost: 35_000,
      sellingPrice: 48_000,
      currency: 'NGN',
      totalRooms: 20,
    },
  });

  // --- Bookings across statuses ---------------------------------------------
  async function makeHotelBooking(opts: {
    ref: string;
    customerId: string;
    hotel: typeof grandHotel;
    roomType: typeof doubleRoom;
    nights: number;
    rooms: number;
    status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';
    bookedByStaffId?: string;
  }) {
    const checkInDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    const checkOutDate = new Date(
      checkInDate.getTime() + opts.nights * 24 * 60 * 60 * 1000,
    );
    const supplierCost = opts.roomType.supplierCost * opts.nights * opts.rooms;
    const totalAmount = opts.roomType.sellingPrice * opts.nights * opts.rooms;
    const markupAmount = totalAmount - supplierCost;

    const booking = await prisma.hotelBooking.create({
      data: {
        bookingReference: opts.ref,
        customerId: opts.customerId,
        bookedByStaffId: opts.bookedByStaffId,
        branchId: opts.bookedByStaffId ? branch.id : undefined,
        provider: 'CATALOG',
        providerOfferId: `${opts.roomType.id}::seed`,
        providerOrderId: `CATALOG-seed-${opts.ref}`,
        status: opts.status,
        currency: 'NGN',
        totalAmount,
        hotelName: opts.hotel.name,
        city: opts.hotel.city,
        country: opts.hotel.country,
        starRating: opts.hotel.starRating,
        roomType: opts.roomType.name,
        checkInDate,
        checkOutDate,
        rooms: opts.rooms,
        guests: opts.roomType.capacity * opts.rooms,
        offerSnapshot: {},
        hotelId: opts.hotel.id,
        roomTypeId: opts.roomType.id,
        supplierCost,
        markupAmount,
        completedAt:
          opts.status === 'COMPLETED' || opts.status === 'REFUNDED'
            ? new Date()
            : undefined,
        completedByStaffId:
          opts.status === 'COMPLETED' || opts.status === 'REFUNDED'
            ? opts.bookedByStaffId
            : undefined,
      },
    });

    await prisma.invoice.create({
      data: {
        invoiceNumber: ref('INV'),
        customerId: opts.customerId,
        hotelBookingId: booking.id,
        status:
          opts.status === 'PENDING' ? InvoiceStatus.ISSUED : InvoiceStatus.PAID,
        currency: 'NGN',
        totalAmount,
        issuedByStaffId: opts.bookedByStaffId,
        payments:
          opts.status === 'PENDING'
            ? undefined
            : {
                create: [
                  {
                    paymentReference: ref('PAY'),
                    amount: totalAmount,
                    method: PaymentMethod.CARD,
                    recordedByStaffId: financeIdentity.staff!.id,
                  },
                ],
              },
        lineItems: {
          create: [
            {
              description: `Hotel ${opts.ref}: ${opts.hotel.name}, ${opts.roomType.name}`,
              amount: totalAmount,
            },
          ],
        },
      },
    });

    return booking;
  }

  await makeHotelBooking({
    ref: 'HTL-DEMO0001',
    customerId: aminaIdentity.customer!.id,
    hotel: grandHotel,
    roomType: doubleRoom,
    nights: 3,
    rooms: 1,
    status: 'PENDING',
  });
  await makeHotelBooking({
    ref: 'HTL-DEMO0002',
    customerId: chineduIdentity.customer!.id,
    hotel: grandHotel,
    roomType: suiteRoom,
    nights: 2,
    rooms: 1,
    status: 'CONFIRMED',
    bookedByStaffId: agentIdentity.staff!.id,
  });
  const completedBooking = await makeHotelBooking({
    ref: 'HTL-DEMO0003',
    customerId: aminaIdentity.customer!.id,
    hotel: grandHotel,
    roomType: doubleRoom,
    nights: 4,
    rooms: 2,
    status: 'COMPLETED',
    bookedByStaffId: agentIdentity.staff!.id,
  });
  await makeHotelBooking({
    ref: 'HTL-DEMO0004',
    customerId: chineduIdentity.customer!.id,
    hotel: madinahHotel,
    roomType: madinahDouble,
    nights: 5,
    rooms: 1,
    status: 'CANCELLED',
  });
  const refundedBooking = await makeHotelBooking({
    ref: 'HTL-DEMO0005',
    customerId: aminaIdentity.customer!.id,
    hotel: grandHotel,
    roomType: doubleRoom,
    nights: 2,
    rooms: 1,
    status: 'REFUNDED',
    bookedByStaffId: agentIdentity.staff!.id,
  });
  await prisma.hotelRefund.create({
    data: {
      bookingId: refundedBooking.id,
      requestedByStaffId: agentIdentity.staff!.id,
      bookingPrice: refundedBooking.totalAmount,
      supplierPenalty: Math.round(refundedBooking.totalAmount * 0.25),
      agencyFee: Math.round(refundedBooking.totalAmount * 0.05),
      refundAmount: Math.round(refundedBooking.totalAmount * 0.7),
      currency: 'NGN',
      status: 'COMPLETED',
      reason: 'Customer travel plans changed',
      completedAt: new Date(),
    },
  });

  // --- Staff incentive on the completed booking -----------------------------
  if (defaultIncentivePolicy) {
    const margin =
      completedBooking.totalAmount - (completedBooking.supplierCost ?? 0);
    await prisma.staffIncentive.create({
      data: {
        staffId: agentIdentity.staff!.id,
        sourceType: 'HOTEL_BOOKING',
        sourceId: completedBooking.id,
        amount: Math.round((margin * 50) / 100),
        currency: 'NGN',
        description: `Incentive on hotel booking ${completedBooking.bookingReference}`,
        status: IncentiveStatus.PENDING,
        referenceNumber: ref('INC'),
        companyCost: completedBooking.supplierCost,
        sellingPrice: completedBooking.totalAmount,
        margin,
        policyId: defaultIncentivePolicy.id,
        customerId: completedBooking.customerId,
      },
    });
  }

  // --- A multi-component travel package (spec #11) --------------------------
  const packageInvoice = await prisma.invoice.create({
    data: {
      invoiceNumber: ref('INV'),
      customerId: chineduIdentity.customer!.id,
      status: InvoiceStatus.PAID,
      currency: 'NGN',
      totalAmount: 250_000 + 60_000 + 5_000,
      issuedByStaffId: agentIdentity.staff!.id,
      payments: {
        create: [
          {
            paymentReference: ref('PAY'),
            amount: 315_000,
            method: PaymentMethod.BANK_TRANSFER,
            recordedByStaffId: financeIdentity.staff!.id,
          },
        ],
      },
      lineItems: {
        create: [
          {
            description: 'Custom package: Lagos -> Dubai flight',
            amount: 250_000,
          },
          { description: 'Custom package: 2 nights hotel', amount: 60_000 },
          { description: 'Custom package: Airport transfer', amount: 5_000 },
        ],
      },
    },
  });
  await prisma.travelPackage.create({
    data: {
      packageReference: ref('PKG'),
      name: 'Chinedu — Custom Lagos to Dubai getaway',
      category: 'STANDARD',
      description:
        'Flight + hotel + transfer, built by a staff member for a customer request.',
      customerId: chineduIdentity.customer!.id,
      totalCost: 210_000 + 45_000 + 3_000,
      totalPrice: 250_000 + 60_000 + 5_000,
      currency: 'NGN',
      createdByStaffId: agentIdentity.staff!.id,
      branchId: branch.id,
      invoiceId: packageInvoice.id,
      components: {
        create: [
          {
            type: 'FLIGHT',
            description: 'Lagos -> Dubai round trip flight',
            cost: 210_000,
            price: 250_000,
          },
          {
            type: 'HOTEL',
            description: '2 nights at a Dubai hotel',
            cost: 45_000,
            price: 60_000,
          },
          {
            type: 'TRANSPORT',
            description: 'Airport transfer both ways',
            cost: 3_000,
            price: 5_000,
          },
        ],
      },
    },
  });

  console.log(
    'Created 2 hotels, 4 room types, 5 hotel bookings (PENDING/CONFIRMED/COMPLETED/CANCELLED/REFUNDED), ' +
      '1 staff incentive, and 1 multi-component travel package.',
  );
  console.log('--------------------------------------------------------');
  console.log('Phase 5 hotel demo data seeded successfully.');
  console.log('--------------------------------------------------------');
}

/**
 * Phase 6 finance demo data: seeds the chart of accounts (idempotent —
 * normally done by FinanceModule.onModuleInit on app boot, but seeded here
 * too so `db:reset:demo`'s seed-before-first-boot ordering never leaves a
 * journal entry pointing at a missing account), a company investment, and
 * two expenses (one still PENDING, one APPROVED+PAID) — each posts a real,
 * balanced journal entry through the same debit/credit shape
 * LedgerService/FinancePostingService would produce, so the Finance
 * Dashboard and Chart of Accounts screens aren't empty on a fresh seed.
 * Deliberately does NOT backfill journal entries for the StaffIncentive/
 * Payment rows Phases 3-5 already seed directly against Prisma (bypassing
 * the service layer, like every other demo record in this file) — the
 * ledger only ever captures transactions that flow through the real app
 * from here on, exactly as it would in production.
 */
async function seedPhase6Finance() {
  for (const def of SEED_ACCOUNTS) {
    await prisma.ledgerAccount.upsert({
      where: { code: def.code },
      create: {
        code: def.code,
        name: def.name,
        type: def.type,
        isSystem: true,
      },
      update: {},
    });
  }

  const existing = await prisma.companyInvestment.findFirst({
    where: { investor: 'Alnajoum Holdings' },
  });
  if (existing) {
    console.log('Phase 6 finance demo data already present — skipping');
    return;
  }

  const accountId = async (code: string) =>
    (await prisma.ledgerAccount.findUniqueOrThrow({ where: { code } })).id;

  const [cashId, bankId, companyInvestmentId, marketingId, hostingId] =
    await Promise.all([
      accountId(ACCOUNT_CODES.CASH),
      accountId(ACCOUNT_CODES.BANK_ACCOUNTS),
      accountId(ACCOUNT_CODES.COMPANY_INVESTMENT),
      accountId(ACCOUNT_CODES.MARKETING),
      accountId(ACCOUNT_CODES.HOSTING),
    ]);

  const financeIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: 'ibrahim.musa@demo.alnajoum.travel' },
    include: { staff: true },
  });
  const superAdminIdentity = await prisma.identity.findFirst({
    where: {
      type: 'STAFF',
      roles: { some: { role: { name: SYSTEM_ROLES.SUPER_ADMIN } } },
    },
  });

  // --- Initial company investment --------------------------------------
  const investment = await prisma.companyInvestment.create({
    data: {
      type: 'INITIAL',
      amount: 20_000_000,
      currency: 'NGN',
      investor: 'Alnajoum Holdings',
      date: new Date('2026-01-01'),
      description: 'Initial capital to launch Alnajoum Travel Agency',
      recordedByIdentityId: superAdminIdentity?.id,
    },
  });
  await prisma.journalEntry.create({
    data: {
      debitAccountId: bankId,
      creditAccountId: companyInvestmentId,
      amount: 20_000_000,
      currency: 'NGN',
      reference: investment.id,
      description: 'Initial investment by Alnajoum Holdings',
      sourceModule: 'INVESTMENT',
      sourceId: investment.id,
      createdByIdentityId: superAdminIdentity?.id,
    },
  });

  // --- Expenses: one still pending, one approved and paid ------------------
  await prisma.expense.create({
    data: {
      expenseNumber: `EXP-${randomBytes(4).toString('hex').toUpperCase()}`,
      category: 'Marketing',
      amount: 150_000,
      currency: 'NGN',
      date: new Date(),
      description: 'Social media advertising campaign',
      vendor: 'Meta Ads',
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      accountId: marketingId,
      status: 'PENDING',
      createdByStaffId: financeIdentity.staff!.id,
    },
  });

  const hostingExpense = await prisma.expense.create({
    data: {
      expenseNumber: `EXP-${randomBytes(4).toString('hex').toUpperCase()}`,
      category: 'Hosting',
      amount: 45_000,
      currency: 'NGN',
      date: new Date(),
      description: 'Monthly Oracle Cloud VPS hosting',
      vendor: 'Oracle Cloud',
      paymentMethod: PaymentMethod.CARD,
      accountId: hostingId,
      status: 'PAID',
      createdByStaffId: financeIdentity.staff!.id,
      approvedByStaffId: financeIdentity.staff!.id,
      approvedAt: new Date(),
      paidAt: new Date(),
    },
  });
  await prisma.journalEntry.create({
    data: {
      debitAccountId: hostingId,
      creditAccountId: cashId,
      amount: 45_000,
      currency: 'NGN',
      reference: hostingExpense.expenseNumber,
      description: `Expense ${hostingExpense.expenseNumber}: Monthly Oracle Cloud VPS hosting`,
      sourceModule: 'EXPENSE',
      sourceId: hostingExpense.id,
      createdByIdentityId: financeIdentity.id,
    },
  });

  console.log(
    'Seeded chart of accounts, 1 company investment, and 2 expenses (1 pending, 1 paid) with matching journal entries.',
  );
  console.log('--------------------------------------------------------');
  console.log('Phase 6 finance demo data seeded successfully.');
  console.log('--------------------------------------------------------');
}

/**
 * Phase 7 CRM demo data: a handful of leads across the pipeline (one still
 * open, one converted, one lost), tasks (manual and auto-created), a
 * support ticket with a full message thread (customer message, internal
 * note, staff reply) demonstrating spec #12's separation, a campaign, one
 * piece of approved feedback, and one complaint. Enough to populate every
 * CRM screen without needing to click through the UI first.
 */
async function seedPhase7Crm() {
  const existing = await prisma.lead.findFirst({
    where: { leadNumber: 'LEAD-DEMO0001' },
  });
  if (existing) {
    console.log('Phase 7 CRM demo data already present — skipping');
    return;
  }

  const agentIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: 'fatima.sule@demo.alnajoum.travel' },
    include: { staff: true },
  });
  const financeIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: 'ibrahim.musa@demo.alnajoum.travel' },
    include: { staff: true },
  });
  const chineduIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: 'chinedu.okafor@demo.alnajoum.travel' },
    include: { customer: true },
  });
  const branch = await prisma.branch.findFirstOrThrow();
  const stages = await prisma.leadStage.findMany({ orderBy: { order: 'asc' } });
  const newStage = stages.find((s) => !s.isWon && !s.isLost)!;
  const qualifiedStage = stages[2] ?? newStage;
  const wonStage = stages.find((s) => s.isWon)!;
  const lostStage = stages.find((s) => s.isLost)!;
  const category = await prisma.supportTicketCategory.findFirstOrThrow({
    where: { name: 'Flight' },
  });

  // --- Campaign ---------------------------------------------------------
  const campaign = await prisma.campaign.create({
    data: {
      name: 'Umrah Ramadan 2027 Early Bird',
      description:
        'Discounted Umrah packages for early registrations ahead of Ramadan 2027.',
      targetService: 'UMRAH',
      targetAudience: 'Returning Umrah customers',
      startDate: new Date('2026-10-01'),
      endDate: new Date('2027-01-31'),
      budget: 500_000,
      channel: 'WHATSAPP',
      status: 'ACTIVE',
      createdByStaffId: agentIdentity.staff!.id,
    },
  });

  // --- Leads across the pipeline -----------------------------------------
  const openLead = await prisma.lead.create({
    data: {
      leadNumber: 'LEAD-DEMO0001',
      name: 'Blessing Adeyemi',
      phone: '+2348021110001',
      email: 'blessing.adeyemi@example.com',
      source: 'WHATSAPP',
      interestedService: 'Umrah Package',
      destination: 'Madinah',
      budget: 900_000,
      stageId: qualifiedStage.id,
      priority: 'HIGH',
      assignedStaffId: agentIdentity.staff!.id,
      assignedBranchId: branch.id,
      campaignId: campaign.id,
      notes:
        'Interested in a family Umrah package for 4 — asked for a quotation.',
      followUpDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      createdByStaffId: agentIdentity.staff!.id,
    },
  });
  await prisma.leadActivity.create({
    data: {
      leadId: openLead.id,
      action: 'created',
      description: 'Lead created from whatsapp',
      performedByStaffId: agentIdentity.staff!.id,
    },
  });

  const lostLead = await prisma.lead.create({
    data: {
      leadNumber: 'LEAD-DEMO0002',
      name: 'Emeka Nwachukwu',
      phone: '+2348021110002',
      source: 'ADVERTISEMENT',
      interestedService: 'Flight to Dubai',
      stageId: lostStage.id,
      status: 'LOST',
      lostReason: 'Booked with a competitor offering a lower fare',
      assignedStaffId: agentIdentity.staff!.id,
      createdByStaffId: agentIdentity.staff!.id,
    },
  });
  await prisma.leadActivity.create({
    data: {
      leadId: lostLead.id,
      action: 'lost',
      description:
        'Marked lost: Booked with a competitor offering a lower fare',
    },
  });

  const convertedLead = await prisma.lead.create({
    data: {
      leadNumber: 'LEAD-DEMO0003',
      name: `${chineduIdentity.customer!.firstName} ${chineduIdentity.customer!.lastName}`,
      phone: '+2348021110003',
      source: 'REFERRAL',
      interestedService: 'Visa application',
      stageId: wonStage.id,
      status: 'CONVERTED',
      convertedCustomerId: chineduIdentity.customer!.id,
      convertedAt: new Date(),
      assignedStaffId: agentIdentity.staff!.id,
      createdByStaffId: agentIdentity.staff!.id,
    },
  });
  await prisma.leadActivity.create({
    data: {
      leadId: convertedLead.id,
      action: 'converted',
      description: `Converted, linked to existing customer (${chineduIdentity.customer!.id})`,
      performedByStaffId: agentIdentity.staff!.id,
    },
  });

  // --- Tasks: one manual follow-up, one auto-created ----------------------
  await prisma.task.create({
    data: {
      title: `Call ${openLead.name} about Umrah package quotation`,
      description: 'Follow up on the family package pricing sent by WhatsApp.',
      relatedType: 'FOLLOW_UP',
      relatedId: openLead.id,
      leadId: openLead.id,
      assignedStaffId: agentIdentity.staff!.id,
      createdByStaffId: agentIdentity.staff!.id,
      dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      priority: 'NORMAL',
    },
  });
  await prisma.task.create({
    data: {
      title: `Overdue payment follow-up: ${chineduIdentity.customer!.firstName} ${chineduIdentity.customer!.lastName}`,
      description:
        'Outstanding balance on a Hajj installment — system-generated reminder.',
      relatedType: 'PAYMENT',
      customerId: chineduIdentity.customer!.id,
      assignedStaffId: financeIdentity.staff!.id,
      isAutoCreated: true,
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      priority: 'HIGH',
    },
  });

  // --- Support ticket with a full message thread --------------------------
  const responseMinutes = 240; // HIGH
  const ticket = await prisma.supportTicket.create({
    data: {
      ticketNumber: 'TKT-DEMO0001',
      customerId: chineduIdentity.customer!.id,
      subject: 'Refund status for cancelled hotel booking',
      categoryId: category.id,
      priority: 'HIGH',
      description:
        'I cancelled my Makkah hotel booking last week and would like an update on my refund.',
      status: 'RESOLVED',
      assignedStaffId: agentIdentity.staff!.id,
      branchId: branch.id,
      slaResponseDueAt: new Date(
        Date.now() - 20 * 60 * 60 * 1000 + responseMinutes * 60_000,
      ),
      firstRespondedAt: new Date(Date.now() - 19 * 60 * 60 * 1000),
      resolvedAt: new Date(Date.now() - 10 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 20 * 60 * 60 * 1000),
    },
  });
  await prisma.supportTicketMessage.create({
    data: {
      ticketId: ticket.id,
      authorType: 'CUSTOMER',
      message:
        'I cancelled my Makkah hotel booking last week and would like an update on my refund.',
      createdAt: new Date(Date.now() - 20 * 60 * 60 * 1000),
    },
  });
  await prisma.supportTicketMessage.create({
    data: {
      ticketId: ticket.id,
      authorType: 'STAFF',
      authorStaffId: agentIdentity.staff!.id,
      message:
        'Checked with finance — the refund was approved yesterday and should reflect within 3-5 business days.',
      isInternal: true,
      createdAt: new Date(Date.now() - 19.5 * 60 * 60 * 1000),
    },
  });
  await prisma.supportTicketMessage.create({
    data: {
      ticketId: ticket.id,
      authorType: 'STAFF',
      authorStaffId: agentIdentity.staff!.id,
      message:
        'Your refund has been approved and should arrive within 3-5 business days.',
      createdAt: new Date(Date.now() - 19 * 60 * 60 * 1000),
    },
  });

  // --- Feedback and complaint ---------------------------------------------
  await prisma.customerFeedback.create({
    data: {
      customerId: chineduIdentity.customer!.id,
      serviceType: 'VISA',
      rating: 5,
      staffRating: 5,
      comment: 'Very smooth visa process, kept me updated throughout.',
      staffId: agentIdentity.staff!.id,
      isApproved: true,
      approvedByStaffId: financeIdentity.staff!.id,
    },
  });

  await prisma.complaint.create({
    data: {
      complaintNumber: 'CMP-DEMO0001',
      customerId: chineduIdentity.customer!.id,
      subject: 'Late hotel check-in confirmation',
      description:
        'The hotel confirmation for my Madinah stay arrived only a day before check-in.',
      status: 'RESOLVED',
      assignedStaffId: agentIdentity.staff!.id,
      resolution:
        'Apologized to the customer and flagged the hotel provider for slower-than-usual confirmations; a goodwill discount was applied to their next booking.',
      resolvedAt: new Date(),
    },
  });

  console.log(
    'Seeded 1 campaign, 3 leads (open/lost/converted), 2 tasks (1 auto-created), ' +
      '1 support ticket with a 3-message thread (customer/internal/staff), 1 approved feedback, and 1 resolved complaint.',
  );
  console.log('--------------------------------------------------------');
  console.log('Phase 7 CRM demo data seeded successfully.');
  console.log('--------------------------------------------------------');
}

/** Phase 8 — Hajj/Umrah groups, fleet, transport, and pilgrim check-in/QR demo data. */
async function seedPhase8HajjOps() {
  const existing = await prisma.hajjGroup.findFirst({
    where: { groupNumber: 'HGRP-DEMO0001' },
  });
  if (existing) {
    console.log('Phase 8 Hajj ops demo data already present — skipping');
    return;
  }

  const agentIdentity = await prisma.identity.findUniqueOrThrow({
    where: { email: 'fatima.sule@demo.alnajoum.travel' },
    include: { staff: true },
  });
  const hajjRegistration = await prisma.hajjRegistration.findFirstOrThrow({
    include: { pilgrims: true },
  });
  const umrahRegistration = await prisma.umrahRegistration.findFirstOrThrow({
    include: { pilgrims: true },
  });
  const coordinatorStaffId = agentIdentity.staff!.id;

  // --- Fleet: one bus + one driver ---------------------------------------
  const bus = await prisma.vehicle.create({
    data: {
      plateNumber: 'LAG-402-KJA',
      type: 'BUS',
      capacity: 45,
      status: 'AVAILABLE',
      notes: 'Air-conditioned coach, contracted for the 2026 Hajj season.',
    },
  });
  const driver = await prisma.driver.create({
    data: {
      firstName: 'Yusuf',
      lastName: 'Bello',
      phone: '+2348030001122',
      licenseNumber: 'LIC-9981234', // sensitive — never returned by the drivers list endpoint
      vehicleId: bus.id,
      status: 'ACTIVE',
    },
  });

  // --- Hajj group: Amina Yusuf's family (3 pilgrims), departs in 20 days ---
  const hajjDepartureDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  const hajjGroup = await prisma.hajjGroup.create({
    data: {
      groupNumber: 'HGRP-DEMO0001',
      name: 'Hajj 2026 — Batch A (Lagos)',
      packageId: hajjRegistration.packageId,
      status: 'REGISTRATION_OPEN',
      departureDate: hajjDepartureDate,
      returnDate: new Date(
        hajjDepartureDate.getTime() + 14 * 24 * 60 * 60 * 1000,
      ),
      airline: 'Saudia',
      maxCapacity: 40,
      coordinatorStaffId,
      notes:
        'Demo group — Amina Yusuf traveling with her spouse and one child.',
    },
  });
  await prisma.hajjRegistrationPilgrim.updateMany({
    where: { registrationId: hajjRegistration.id },
    data: { groupId: hajjGroup.id },
  });

  // Spec #30: one pilgrim demonstrates the authorized, audited manual
  // readiness override (e.g. photo verified in person, upload still pending).
  const childPilgrim = hajjRegistration.pilgrims.find((p) => p.familyMemberId);
  if (childPilgrim) {
    await prisma.pilgrimReadinessOverride.create({
      data: {
        pilgrimType: 'HAJJ',
        pilgrimId: childPilgrim.id,
        status: 'AMBER',
        reason:
          'Photo verified in person at the branch; system upload still pending from the family.',
        overriddenByStaffId: coordinatorStaffId,
      },
    });
  }

  // --- Umrah group: Chinedu Okafor's VIP Umrah, departs in 8 days --------
  const umrahDepartureDate = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
  const umrahGroup = await prisma.umrahGroup.create({
    data: {
      groupNumber: 'UGRP-DEMO0001',
      name: 'VIP Umrah — Chinedu Okafor',
      groupType: 'VIP',
      packageId: umrahRegistration.packageId,
      status: 'FULL',
      departureDate: umrahDepartureDate,
      returnDate: new Date(
        umrahDepartureDate.getTime() + 10 * 24 * 60 * 60 * 1000,
      ),
      airline: 'Qatar Airways',
      maxCapacity: 1,
      coordinatorStaffId,
    },
  });
  await prisma.umrahRegistrationPilgrim.updateMany({
    where: { registrationId: umrahRegistration.id },
    data: { groupId: umrahGroup.id },
  });

  // --- Transport: airport transfer for the Hajj group ---------------------
  await prisma.transport.create({
    data: {
      type: 'AIRPORT_TRANSFER',
      hajjGroupId: hajjGroup.id,
      vehicleId: bus.id,
      driverId: driver.id,
      pickupLocation: 'Hajj Camp, Lagos',
      dropoffLocation: 'Murtala Muhammed International Airport',
      scheduledAt: new Date(hajjDepartureDate.getTime() - 4 * 60 * 60 * 1000),
      status: 'SCHEDULED',
    },
  });

  // --- Room allocation: a quad room in Makkah, 2 of 3 Hajj pilgrims placed ---
  const makkahRoom = await prisma.roomAllocation.create({
    data: {
      hajjGroupId: hajjGroup.id,
      hotelName: 'Hilton Suites Makkah',
      roomType: 'Quad',
      roomNumber: '412',
      capacity: 4,
    },
  });
  for (const pilgrim of hajjRegistration.pilgrims.slice(0, 2)) {
    await prisma.roomAllocationOccupant.create({
      data: {
        roomAllocationId: makkahRoom.id,
        pilgrimType: 'HAJJ',
        pilgrimId: pilgrim.id,
      },
    });
  }

  // --- QR code + check-in: Chinedu is already checked in for his group ----
  const umrahPilgrim = umrahRegistration.pilgrims[0];
  const pilgrimCode = `PLG-${randomBytes(6).toString('hex').toUpperCase()}`;
  await prisma.umrahRegistrationPilgrim.update({
    where: { id: umrahPilgrim.id },
    data: { pilgrimCode },
  });
  await prisma.pilgrimCheckIn.create({
    data: {
      pilgrimType: 'UMRAH',
      pilgrimId: umrahPilgrim.id,
      event: 'GROUP_CHECK_IN',
      location: 'Branch office, Victoria Island',
      staffId: coordinatorStaffId,
    },
  });

  console.log(
    `Created Hajj group ${hajjGroup.groupNumber} (3 pilgrims, 1 readiness override, 1 room with 2 occupants) and Umrah group ${umrahGroup.groupNumber} ` +
      `(1 pilgrim, checked in, QR code ${pilgrimCode}), 1 vehicle, 1 driver, 1 airport transfer.`,
  );
  console.log('--------------------------------------------------------');
  console.log('Phase 8 Hajj ops demo data seeded successfully.');
  console.log('--------------------------------------------------------');
}

async function main() {
  await seedPhase1And2();
  await seedPhase3Visa();
  await seedPhase4Flights();
  await seedPhase5Hotels();
  await seedPhase6Finance();
  await seedPhase7Crm();
  await seedPhase8HajjOps();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
