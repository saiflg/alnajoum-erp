import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  TaskPriority,
  TaskRelatedType,
  VisaApplicationStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TasksService } from '../crm/tasks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TERMINAL_STATUSES } from './visa.service';

/**
 * Spec #23 (expiry tracking) and #30 (SLA overdue tracking) — two daily
 * sweeps over VisaApplication, mirroring HajjOpsAutomationService's
 * structure (a scheduled entry point plus an independently-testable
 * runAll()). Reuses TasksService.createAuto for staff alerts (spec #26)
 * rather than inventing a second task/reminder mechanism, and
 * NotificationsService for the customer-facing expiry notice — same "don't
 * duplicate" discipline as every other Phase 9 service.
 */
@Injectable()
export class VisaOpsAutomationService {
  private readonly logger = new Logger(VisaOpsAutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async runScheduled(): Promise<void> {
    const result = await this.runAll();
    this.logger.log(
      `Visa ops automation sweep complete: ${JSON.stringify(result)}`,
    );
  }

  async runAll() {
    const [overdueTasks, expiredCount] = await Promise.all([
      this.flagOverdueApplications(),
      this.expireIssuedVisas(),
    ]);
    return { overdueTasks, expiredCount };
  }

  /**
   * Spec #30: "track applications exceeding the configured SLA target" —
   * never a hard-coded universal deadline, just whatever slaDueAt was
   * snapshotted onto the application at submission time (see
   * VisaSubmissionsService.submit). A terminal application (already
   * COMPLETED/CANCELLED/REJECTED/ISSUED/EXPIRED) can never be "overdue" —
   * there's nothing left to chase.
   */
  private async flagOverdueApplications(): Promise<number> {
    const overdue = await this.prisma.visaApplication.findMany({
      where: {
        slaDueAt: { lt: new Date() },
        status: { notIn: TERMINAL_STATUSES },
      },
      select: {
        id: true,
        applicationReference: true,
        assignedStaffId: true,
        appliedByStaffId: true,
        slaDueAt: true,
      },
    });

    let count = 0;
    for (const application of overdue) {
      const assignee =
        application.assignedStaffId ?? application.appliedByStaffId;
      if (!assignee) continue; // spec #26's own convention: no unassigned auto-tasks

      await this.tasksService.createAuto({
        title: `SLA overdue: ${application.applicationReference}`,
        description: `This visa application passed its SLA target (due ${application.slaDueAt?.toISOString().slice(0, 10)}) and has not yet been finalized.`,
        relatedType: TaskRelatedType.VISA,
        relatedId: `${application.id}:sla-overdue`,
        assignedStaffId: assignee,
        dueDate: new Date(),
        priority: TaskPriority.HIGH,
      });
      count++;
    }
    return count;
  }

  /**
   * Spec #23: an issued visa's own expiryDate passing moves it to EXPIRED —
   * the one sanctioned direct writer of that status (see the enum comment
   * in schema.prisma), since VisaService.updateStatus's terminal-status
   * guard would otherwise refuse to move a COMPLETED application anywhere.
   */
  private async expireIssuedVisas(): Promise<number> {
    const expiring = await this.prisma.visaApplication.findMany({
      where: {
        expiryDate: { lt: new Date() },
        status: {
          notIn: [
            VisaApplicationStatus.EXPIRED,
            VisaApplicationStatus.CANCELLED,
            VisaApplicationStatus.REJECTED,
          ],
        },
      },
      include: {
        customer: {
          include: { identity: { select: { email: true, id: true } } },
        },
      },
    });

    for (const application of expiring) {
      await this.prisma.visaApplication.update({
        where: { id: application.id },
        data: { status: VisaApplicationStatus.EXPIRED },
      });
      await this.auditService.record({
        action: 'visa_application.expired',
        entityType: 'VisaApplication',
        entityId: application.id,
        metadata: { expiryDate: application.expiryDate },
      });
      await this.notificationsService.sendGeneric(
        application.customer.identity.email,
        application.customer.identity.id,
        `Visa expired — ${application.applicationReference}`,
        `Your visa for ${application.destinationCountry} (application ${application.applicationReference}) has expired.`,
      );
    }
    return expiring.length;
  }
}
