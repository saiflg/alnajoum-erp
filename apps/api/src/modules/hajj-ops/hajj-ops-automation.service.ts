import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  TaskPriority,
  TaskRelatedType,
  TravelGroupStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TasksService } from '../crm/tasks.service';

// Spec #26: "auto-generated operations tasks at configurable intervals
// before departure (30/14/7/3/1 days)". A group is only ever reminded once
// per interval — TasksService.createAuto is idempotent per
// (relatedType, relatedId), and here relatedId is `${groupId}:${days}` so
// each interval gets its own dedupe key instead of collapsing into one.
const DEPARTURE_REMINDER_INTERVALS_DAYS = [30, 14, 7, 3, 1];

const ACTIVE_GROUP_STATUSES: TravelGroupStatus[] = [
  TravelGroupStatus.PLANNING,
  TravelGroupStatus.REGISTRATION_OPEN,
  TravelGroupStatus.ALMOST_FULL,
  TravelGroupStatus.FULL,
];

interface DepartingGroup {
  id: string;
  groupNumber: string;
  name: string;
  departureDate: Date | null;
  coordinatorStaffId: string | null;
}

/**
 * Spec #9 ("payment overdue" / "flight departure approaching") is already
 * covered generically for Hajj/Umrah invoices and flight bookings by
 * CrmAutomationService (Phase 7) — those checks are NOT duplicated here.
 * This sweep only adds what's specific to Phase 8: pre-departure group
 * countdown tasks for the group coordinator.
 */
@Injectable()
export class HajjOpsAutomationService {
  private readonly logger = new Logger(HajjOpsAutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async runScheduled(): Promise<void> {
    const result = await this.runAll();
    this.logger.log(
      `Hajj ops automation sweep complete: ${JSON.stringify(result)}`,
    );
  }

  async runAll() {
    const [hajjGroups, umrahGroups] = await Promise.all([
      this.prisma.hajjGroup.findMany({
        where: {
          status: { in: ACTIVE_GROUP_STATUSES },
          departureDate: { not: null },
          coordinatorStaffId: { not: null },
        },
        select: {
          id: true,
          groupNumber: true,
          name: true,
          departureDate: true,
          coordinatorStaffId: true,
        },
      }),
      this.prisma.umrahGroup.findMany({
        where: {
          status: { in: ACTIVE_GROUP_STATUSES },
          departureDate: { not: null },
          coordinatorStaffId: { not: null },
        },
        select: {
          id: true,
          groupNumber: true,
          name: true,
          departureDate: true,
          coordinatorStaffId: true,
        },
      }),
    ]);

    const [hajjDepartureTasks, umrahDepartureTasks] = await Promise.all([
      this.createDepartureCountdownTasks(hajjGroups, TaskRelatedType.HAJJ),
      this.createDepartureCountdownTasks(umrahGroups, TaskRelatedType.UMRAH),
    ]);
    return { hajjDepartureTasks, umrahDepartureTasks };
  }

  private async createDepartureCountdownTasks(
    groups: DepartingGroup[],
    relatedType: TaskRelatedType,
  ): Promise<number> {
    let count = 0;
    const now = Date.now();

    for (const group of groups) {
      if (!group.coordinatorStaffId || !group.departureDate) continue;
      const daysUntilDeparture = Math.ceil(
        (group.departureDate.getTime() - now) / (1000 * 60 * 60 * 24),
      );
      for (const interval of DEPARTURE_REMINDER_INTERVALS_DAYS) {
        if (daysUntilDeparture !== interval) continue;
        await this.tasksService.createAuto({
          title: `${group.groupNumber} departs in ${interval} day${interval === 1 ? '' : 's'}`,
          description: `Group "${group.name}" (${group.groupNumber}) departs ${group.departureDate.toISOString().slice(0, 10)} — verify readiness/manifest/transport for all assigned pilgrims.`,
          relatedType,
          relatedId: `${group.id}:${interval}`,
          assignedStaffId: group.coordinatorStaffId,
          dueDate: new Date(now + 24 * 60 * 60 * 1000),
          priority: interval <= 3 ? TaskPriority.HIGH : TaskPriority.NORMAL,
        });
        count++;
      }
    }
    return count;
  }
}
