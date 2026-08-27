/**
 * Phase 2 demo data: fictional customers, a family group, wallet activity,
 * Hajj/Umrah packages and registrations, a manual payment awaiting review,
 * staff assignment, and a few in-app notifications — enough to exercise
 * every Phase 2 screen without registering through the UI first.
 *
 * Entirely separate from seed.ts (the Phase 1 bootstrap: permissions,
 * roles, the first Company/Branch/Super Admin) — this only ever ADDS demo
 * records under obviously-fictional @demo.alnajoum.travel addresses, never
 * touches real customer accounts, and is safe to re-run (skips entirely if
 * the demo data already exists — see main()).
 *
 * All names, passport numbers, phone numbers, and bank details below are
 * fictional. Nothing here is a real document, account, or API credential.
 *
 * Run: pnpm --filter api run db:seed:demo
 * Full reset + reseed: pnpm --filter api run db:reset:demo
 */
import { PrismaClient, PackageStatus, RegistrationStatus, WalletTransactionType, WalletTransactionStatus, PaymentMethod, InvoiceStatus, ManualPaymentStatus, NotificationType, NotificationStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { SYSTEM_ROLES } from '../src/modules/rbac/constants/default-roles.constant';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Demo@2026';
const MARKER_EMAIL = 'amina.yusuf@demo.alnajoum.travel';

function ref(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

async function main() {
  const existing = await prisma.identity.findUnique({ where: { email: MARKER_EMAIL } });
  if (existing) {
    console.log('Demo data already present — skipping (use db:reset:demo for a clean slate)');
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
        create: [
          {
            description: `Hajj package ${hajjStandard.name} (${hajjRegistration.registrationNumber}) — ${hajjPilgrims.length} pilgrims`,
            amount: hajjTotal,
          },
        ],
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
        create: [
          {
            description: `Umrah package ${umrahEconomy.name} (${umrahRegistration.registrationNumber})`,
            amount: umrahTotal,
          },
        ],
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
  console.log('Demo data seeded successfully. Demo logins (password for all: Demo@2026):');
  console.log(`  Customer:        ${aminaIdentity.email}`);
  console.log(`  Customer (VIP):  ${chineduIdentity.email}`);
  console.log(`  Staff (agent):   ${agentIdentity.email}`);
  console.log(`  Staff (finance): ${financeIdentity.email}`);
  console.log('--------------------------------------------------------');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
