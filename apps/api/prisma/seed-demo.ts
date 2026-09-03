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

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Demo@2026';
const MARKER_EMAIL = 'amina.yusuf@demo.alnajoum.travel';

function ref(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** Phase 1/2 demo data — customers, family, Hajj/Umrah, wallet, manual payment. */
async function seedPhase1And2() {
  const existing = await prisma.identity.findUnique({ where: { email: MARKER_EMAIL } });
  if (existing) {
    console.log('Phase 1/2 demo data already present — skipping');
    return;
  }

  const company = await prisma.company.findFirstOrThrow();
  const branch = await prisma.branch.findFirstOrThrow({ where: { companyId: company.id } });
  const staffRole = await prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.STAFF } });
  const financeRole = await prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.FINANCE_OFFICER } });

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

  console.log(`Created demo staff: ${agentIdentity.email}, ${financeIdentity.email} (password: ${DEMO_PASSWORD})`);

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
      roles: { create: [{ roleId: (await prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.CUSTOMER } })).id }] },
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
      roles: { create: [{ roleId: (await prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.CUSTOMER } })).id }] },
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

  console.log(`Created demo customers: ${aminaIdentity.email}, ${chineduIdentity.email} (password: ${DEMO_PASSWORD})`);

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
  console.log('Created a 4-member family group for Amina Yusuf (spouse + 2 children)');

  // --- Hajj packages -------------------------------------------------------
  const hajjStandard = await prisma.hajjPackage.create({
    data: {
      name: 'Standard Hajj 2027',
      description: 'Economy-tier Hajj package with shared accommodation near Haram.',
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
      paymentPlan: 'Deposit ₦500,000, then flexible installments before departure.',
      termsAndConditions: 'Full balance due 30 days before departure. Non-refundable deposit.',
      requiredDocuments: 'Passport, passport photograph, yellow fever card, vaccination certificate',
      status: PackageStatus.PUBLISHED,
    },
  });
  await prisma.hajjPackage.create({
    data: {
      name: 'Premium Hajj 2027',
      description: 'Premium Hajj package with private hotel rooms close to Haram.',
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
    { customerId: aminaIdentity.customer!.id, familyMemberId: null, firstName: 'Amina', lastName: 'Yusuf', passportNumber: 'A00100101' },
    { customerId: null, familyMemberId: spouse.id, firstName: spouse.firstName, lastName: spouse.lastName, passportNumber: spouse.passportNumber },
    { customerId: null, familyMemberId: child1.id, firstName: child1.firstName, lastName: child1.lastName, passportNumber: child1.passportNumber },
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
    { customerId: chineduIdentity.customer!.id, familyMemberId: null, firstName: 'Chinedu', lastName: 'Okafor', passportNumber: 'A00200201' },
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
  const incentivePercent = (umrahEconomy.incentiveRule as { percent: number }).percent;
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
  console.log(`Created Umrah registration ${umrahRegistration.registrationNumber} for Chinedu Okafor — paid in full, staff incentive recorded`);

  // --- Wallet activity for Amina --------------------------------------
  const aminaWallet = await prisma.wallet.create({ data: { customerId: aminaIdentity.customer!.id } });
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
  console.log('Phase 1/2 demo data seeded successfully. Demo logins (password for all: Demo@2026):');
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
  console.log('Created 2 incentive policies (Standard 50% — platform default, and Full Margin Bonus)');

  const svSaudiPilgrimage = await prisma.visaService.create({
    data: {
      serviceCode: ref('VS'),
      country: 'Saudi Arabia',
      visaType: 'Pilgrimage',
      visaCategory: 'Umrah',
      description: 'Umrah pilgrimage visa, processed through our licensed Saudi partner.',
      processingTime: '10-15 business days',
      validityPeriod: '90 days, single entry',
      entryType: 'Single',
      requiredDocuments: 'Passport (6+ months validity), passport photo, vaccination certificate',
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
      requiredDocuments: 'Passport, bank statement, proof of accommodation, invitation letter (if applicable)',
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
      requiredDocuments: 'Passport, admission letter, proof of funds, medical exam',
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
      description: 'US tourist visa — temporarily suspended pending embassy schedule changes.',
      companyCost: 400_000,
      sellingPrice: 400_000, // zero margin on purpose — a realistic "break-even, do not sell yet" state
      currency: 'NGN',
      requiresGuarantor: true,
      status: VisaServiceStatus.SUSPENDED,
    },
  });
  console.log('Created 5 visa services (Saudi Pilgrimage, UK Tourist, Canada Student, UAE Business [draft], US Tourist [suspended])');

  // Helper matching VisaService.submit()'s pricing/snapshot logic, since
  // this script writes directly via Prisma rather than going through the
  // API/service layer (same reasoning as every other section above).
  function visaTotal(sv: { sellingPrice: number; processingFee: number; otherFees: number }) {
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
      lineItems: { create: [{ description: `Pilgrimage visa processing (${visaApp1.applicationReference}) — Saudi Arabia, Amina Yusuf`, amount: visaApp1.totalAmount }] },
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
      lineItems: { create: [{ description: `Tourist visa processing (${visaApp2.applicationReference}) — United Kingdom, ${spouse.firstName} ${spouse.lastName}`, amount: visaApp2.totalAmount }] },
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
      guarantorExemptReason: 'Long-standing VIP client, waived by branch manager',
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
      lineItems: { create: [{ description: `Tourist visa processing (${visaApp3.applicationReference}) — United Kingdom, Chinedu Okafor`, amount: visaApp3.totalAmount }] },
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
      payments: { create: [{ paymentReference: ref('PAY'), amount: visaApp4.totalAmount, method: PaymentMethod.CARD, recordedByStaffId: financeIdentity.staff!.id }] },
      lineItems: { create: [{ description: `Student visa processing (${visaApp4.applicationReference}) — Canada, Chinedu Okafor`, amount: visaApp4.totalAmount }] },
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
      payments: { create: [{ paymentReference: ref('PAY'), amount: visaApp5.totalAmount, method: PaymentMethod.BANK_TRANSFER, recordedByStaffId: financeIdentity.staff!.id }] },
      lineItems: { create: [{ description: `Pilgrimage visa processing (${visaApp5.applicationReference}) — Saudi Arabia, Amina Yusuf`, amount: visaApp5.totalAmount }] },
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
      payments: { create: [{ paymentReference: ref('PAY'), amount: visaApp6.totalAmount, method: PaymentMethod.BANK_TRANSFER, recordedByStaffId: financeIdentity.staff!.id }] },
      lineItems: { create: [{ description: `Pilgrimage visa processing (${visaApp6.applicationReference}) — Saudi Arabia, Amina Yusuf`, amount: visaApp6.totalAmount }] },
    },
  });
  const margin6 = svSaudiPilgrimage.sellingPrice - svSaudiPilgrimage.companyCost;
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
      guarantorExemptReason: 'Repeat customer, previously approved guarantor on file',
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
      payments: { create: [{ paymentReference: ref('PAY'), amount: visaApp7.totalAmount, method: PaymentMethod.CARD, recordedByStaffId: financeIdentity.staff!.id }] },
      lineItems: { create: [{ description: `Tourist visa processing (${visaApp7.applicationReference}) — United Kingdom, Chinedu Okafor`, amount: visaApp7.totalAmount }] },
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
      guarantorExemptReason: 'Minor traveling with a parent already on file as guarantor',
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
      payments: { create: [{ paymentReference: ref('PAY'), amount: visaApp8.totalAmount, method: PaymentMethod.WALLET, recordedByStaffId: financeIdentity.staff!.id }] },
      lineItems: { create: [{ description: `Pilgrimage visa processing (${visaApp8.applicationReference}) — Saudi Arabia, ${child1.firstName} ${child1.lastName}`, amount: visaApp8.totalAmount }] },
    },
  });
  const margin8 = svSaudiPilgrimage.sellingPrice - svSaudiPilgrimage.companyCost;
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
      offlineReason: 'Customer called in and paid cash at the branch; processed by phone, no portal submission.',
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
      payments: { create: [{ paymentReference: ref('PAY'), amount: visaApp9.totalAmount, method: PaymentMethod.CASH, note: 'Cash at branch — offline entry', recordedByStaffId: financeIdentity.staff!.id }] },
      lineItems: { create: [{ description: `Pilgrimage visa processing (${visaApp9.applicationReference}) — Saudi Arabia, Chinedu Okafor [OFFLINE]`, amount: visaApp9.totalAmount }] },
    },
  });
  const margin9 = svSaudiPilgrimage.sellingPrice - svSaudiPilgrimage.companyCost;
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
      providerError: 'Bank rejected the transfer: account number could not be verified',
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
      staffNote: 'Insufficient proof of funds to support the full duration of study.',
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
  console.log('  Visa officer: fatima.sule@demo.alnajoum.travel (has bank details on file)');
  console.log('  Finance:      ibrahim.musa@demo.alnajoum.travel');
  console.log('--------------------------------------------------------');
}

async function main() {
  await seedPhase1And2();
  await seedPhase3Visa();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
