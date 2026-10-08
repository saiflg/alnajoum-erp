import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  checkProductionConfig,
  isProductionEnv,
} from '../../common/security/runtime-environment';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const DAY = 24 * 60 * 60 * 1000;

export type ControlStatus = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';

export interface SecurityControl {
  id: string;
  title: string;
  status: ControlStatus;
  detail: string;
  /** Where the evidence comes from, so a reader can check it for themselves. */
  evidence: string;
}

/** Audit actions that matter to a security reader, with the label shown on the dashboard. */
const WATCHED_ACTIONS: Array<[string, string]> = [
  ['security.login_failed', 'Failed sign-ins'],
  ['security.account_locked', 'Accounts locked'],
  ['security.role_changed', 'Role changes'],
  ['security.role_escalation_blocked', 'Blocked role escalations'],
  ['security.password_reset_requested', 'Password resets requested'],
  ['security.api_key_created', 'API keys created'],
  ['customer_document.downloaded', 'Customer documents opened by staff'],
  ['security.break_glass_activated', 'Emergency (break-glass) grants'],
];

/**
 * The security dashboard and control register. Everything here is computed from live data - audit rows,
 * accounts, files on disk, process configuration - not asserted. A control that cannot be measured says
 * UNKNOWN rather than PASS. This is an operational view, not a compliance certificate.
 */
@Injectable()
export class SecurityOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(tenant?: string) {
    return tenant === undefined ? {} : { companyId: tenant };
  }

  async overview(tenant?: string) {
    const now = Date.now();
    const since24h = new Date(now - DAY);
    const since7d = new Date(now - 7 * DAY);

    const counts = await Promise.all(
      WATCHED_ACTIONS.map(async ([action, label]) => {
        const [last24h, last7d] = await Promise.all([
          this.prisma.auditLog.count({
            where: {
              action,
              createdAt: { gte: since24h },
              ...this.scope(tenant),
            },
          }),
          this.prisma.auditLog.count({
            where: {
              action,
              createdAt: { gte: since7d },
              ...this.scope(tenant),
            },
          }),
        ]);
        return { action, label, last24h, last7d };
      }),
    );

    const staffScope = tenant === undefined ? {} : { companyId: tenant };
    const [openIncidents, criticalIncidents, staff, privileged] =
      await Promise.all([
        this.prisma.securityIncident.count({
          where: {
            status: { in: ['OPEN', 'INVESTIGATING', 'CONTAINED'] },
            ...this.scope(tenant),
          },
        }),
        this.prisma.securityIncident.count({
          where: {
            status: { in: ['OPEN', 'INVESTIGATING', 'CONTAINED'] },
            severity: 'CRITICAL',
            ...this.scope(tenant),
          },
        }),
        this.prisma.staff.findMany({
          where: { isActive: true, ...staffScope },
          select: {
            identity: { select: { lastLoginAt: true, twoFactorEnabled: true } },
          },
        }),
        this.privilegedStaff(tenant),
      ]);

    const stale = staff.filter(
      (s) =>
        !s.identity.lastLoginAt ||
        s.identity.lastLoginAt.getTime() < now - 90 * DAY,
    ).length;
    const withoutTwoFactor = privileged.filter((p) => !p.twoFactorEnabled);

    return {
      generatedAt: new Date().toISOString(),
      events: counts,
      incidents: { open: openIncidents, openCritical: criticalIncidents },
      accounts: {
        activeStaff: staff.length,
        notSeenIn90Days: stale,
        privilegedAccounts: privileged.length,
        privilegedWithoutTwoFactor: withoutTwoFactor.length,
        privilegedWithoutTwoFactorEmails: withoutTwoFactor.map((p) => p.email),
      },
    };
  }

  private async privilegedStaff(tenant?: string) {
    const rows = await this.prisma.identity.findMany({
      where: {
        status: 'ACTIVE',
        staff:
          tenant === undefined
            ? { isNot: null }
            : { is: { companyId: tenant } },
        roles: {
          some: {
            role: {
              name: { in: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER'] },
            },
          },
        },
      },
      select: { email: true, twoFactorEnabled: true },
    });
    return rows;
  }

  /** The control register: each row is a check that was just run. */
  async controls(tenant?: string): Promise<SecurityControl[]> {
    const out: SecurityControl[] = [];
    const add = (c: SecurityControl) => out.push(c);
    const now = Date.now();

    // Configuration gates (the same checks the API refuses to boot on in production).
    const issues = checkProductionConfig({
      ...process.env,
      NODE_ENV: 'production',
    });
    const errors = issues.filter((i) => i.level === 'error');
    add({
      id: 'CFG-01',
      title:
        'Production configuration is safe (no mock payment/WhatsApp, strong secrets, encryption key)',
      status:
        errors.length === 0 ? 'PASS' : isProductionEnv() ? 'FAIL' : 'WARN',
      detail:
        errors.length === 0
          ? 'This environment would pass the production start-up checks.'
          : `${errors.length} production check(s) would fail here: ${errors.map((e) => e.key).join(', ')}${isProductionEnv() ? '' : ' (this is a development environment, so this is expected)'}`,
      evidence:
        'checkProductionConfig() evaluated against the running process environment',
    });
    add({
      id: 'CFG-02',
      title: 'Running in production mode',
      status: isProductionEnv() ? 'PASS' : 'WARN',
      detail: `NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}`,
      evidence: 'process.env.NODE_ENV',
    });
    add({
      id: 'CFG-03',
      title:
        'Reverse proxy hop count is configured (rate limits and audit IPs see real clients)',
      status:
        Number(process.env.TRUST_PROXY_HOPS) > 0
          ? 'PASS'
          : isProductionEnv()
            ? 'FAIL'
            : 'WARN',
      detail: `TRUST_PROXY_HOPS=${process.env.TRUST_PROXY_HOPS ?? '(unset)'}`,
      evidence: 'process.env.TRUST_PROXY_HOPS',
    });
    add({
      id: 'CFG-04',
      title: 'Data encryption key is configured',
      status: process.env.DATA_ENCRYPTION_KEYS
        ? 'PASS'
        : isProductionEnv()
          ? 'FAIL'
          : 'WARN',
      detail: process.env.DATA_ENCRYPTION_KEYS
        ? 'Integration secrets are encrypted with a configured key.'
        : 'No DATA_ENCRYPTION_KEYS: a key derived from the JWT refresh secret is used (development only).',
      evidence:
        'process.env.DATA_ENCRYPTION_KEYS (presence only - the value is never read out)',
    });

    // Access
    const privileged = await this.privilegedStaff(tenant);
    const noMfa = privileged.filter((p) => !p.twoFactorEnabled);
    add({
      id: 'ACC-01',
      title: 'Privileged accounts use two-factor authentication',
      status:
        privileged.length === 0
          ? 'UNKNOWN'
          : noMfa.length === 0
            ? 'PASS'
            : noMfa.length === privileged.length
              ? 'FAIL'
              : 'WARN',
      detail: `${privileged.length - noMfa.length} of ${privileged.length} admin/finance accounts have two-factor enabled.`,
      evidence:
        'identities with SUPER_ADMIN / COMPANY_ADMIN / FINANCE_OFFICER and twoFactorEnabled',
    });

    if (tenant !== undefined) {
      const lastReview = await this.prisma.accessReview.findFirst({
        where: { companyId: tenant, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      });
      const age = lastReview?.completedAt
        ? (now - lastReview.completedAt.getTime()) / DAY
        : null;
      add({
        id: 'ACC-02',
        title: 'A user access review was completed in the last 90 days',
        status: age === null ? 'FAIL' : age <= 90 ? 'PASS' : 'WARN',
        detail:
          age === null
            ? 'No access review has ever been completed.'
            : `Last completed ${Math.floor(age)} day(s) ago.`,
        evidence: 'access_reviews (COMPLETED)',
      });
    }

    // Data protection
    const backupDir = path.resolve(
      process.cwd(),
      process.env.BACKUPS_DIR ?? './backups',
    );
    let newest: number | null = null;
    try {
      for (const f of fs.readdirSync(backupDir)) {
        if (!/\.dump(\.enc)?$/.test(f)) continue;
        const m = fs.statSync(path.join(backupDir, f)).mtimeMs;
        if (newest === null || m > newest) newest = m;
      }
    } catch {
      newest = null;
    }
    add({
      id: 'DAT-01',
      title: 'A database backup was taken in the last 24 hours',
      status:
        newest === null
          ? 'FAIL'
          : now - newest <= DAY
            ? 'PASS'
            : now - newest <= 7 * DAY
              ? 'WARN'
              : 'FAIL',
      detail:
        newest === null
          ? 'No backup file found.'
          : `Newest backup is ${Math.floor((now - newest) / 3600000)} hour(s) old.`,
      evidence: `files in ${backupDir}`,
    });
    add({
      id: 'DAT-02',
      title: 'A backup has been restore-tested',
      status: 'UNKNOWN',
      detail:
        'The system cannot observe this. Run deploy/restore-check.sh and record the result; the procedure and last recorded result are in docs/disaster-recovery.md.',
      evidence: 'manual - docs/disaster-recovery.md',
    });

    const openCritical = await this.prisma.securityIncident.count({
      where: {
        status: { in: ['OPEN', 'INVESTIGATING', 'CONTAINED'] },
        severity: { in: ['HIGH', 'CRITICAL'] },
        ...this.scope(tenant),
      },
    });
    add({
      id: 'INC-01',
      title: 'No unresolved high/critical security incidents',
      status: openCritical === 0 ? 'PASS' : 'FAIL',
      detail: openCritical === 0 ? 'None open.' : `${openCritical} open.`,
      evidence: 'security_incidents',
    });

    const lockouts = await this.prisma.auditLog.count({
      where: {
        action: 'security.login_failed',
        createdAt: { gte: new Date(now - DAY) },
        ...this.scope(tenant),
      },
    });
    add({
      id: 'MON-01',
      title: 'Sign-in failures in the last 24 hours are within a normal range',
      status: lockouts < 50 ? 'PASS' : lockouts < 200 ? 'WARN' : 'FAIL',
      detail: `${lockouts} failed sign-in attempt(s).`,
      evidence: 'audit_logs security.login_failed',
    });

    return out;
  }
}
