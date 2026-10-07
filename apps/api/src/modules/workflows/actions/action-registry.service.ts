import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { TasksService } from '../../crm/tasks.service';
import { WhatsAppConversationsService } from '../../whatsapp/whatsapp-conversations.service';
import { WorkflowEventBus } from '../events/workflow-event-bus.service';
import { ActionInfo } from '../engine/simulate';
import { WorkflowAction } from './action.types';
import { AuditNoteAction } from './audit-note.action';
import { EmitEventAction } from './emit-event.action';
import { NotifyAction, WhatsAppNotifyAction } from './notify.actions';
import { TaskCreateAction } from './task-create.action';
import { TimelineAction } from './timeline.action';

/**
 * The closed set of things a workflow can do. Authors choose from this list by key; they
 * cannot add to it, and nothing here executes author-supplied code. Adding a capability
 * means writing a reviewed class and registering it here.
 */
@Injectable()
export class ActionRegistryService {
  private readonly actions = new Map<string, WorkflowAction>();

  constructor(
    prisma: PrismaService,
    tasks: TasksService,
    notifications: NotificationsService,
    whatsapp: WhatsAppConversationsService,
    audit: AuditService,
    bus: WorkflowEventBus,
  ) {
    for (const a of [
      new TaskCreateAction(prisma, tasks),
      new TimelineAction(prisma),
      new NotifyAction('EMAIL', prisma, notifications),
      new NotifyAction('SMS', prisma, notifications),
      new NotifyAction('PUSH', prisma, notifications),
      new WhatsAppNotifyAction(prisma, whatsapp),
      new AuditNoteAction(audit),
      new EmitEventAction(bus),
    ] as WorkflowAction[]) {
      this.actions.set(a.key, a);
    }
  }

  get(key: string): WorkflowAction | undefined {
    return this.actions.get(key);
  }

  list(): {
    key: string;
    label: string;
    sideEffect: string;
    requiredPermissions: string[];
  }[] {
    return [...this.actions.values()].map((a) => ({
      key: a.key,
      label: a.label,
      sideEffect: a.sideEffect,
      requiredPermissions: a.requiredPermissions,
    }));
  }

  keys(): Set<string> {
    return new Set(this.actions.keys());
  }

  info(): Map<string, ActionInfo> {
    return new Map(
      [...this.actions].map(([k, a]) => [
        k,
        { label: a.label, sideEffect: a.sideEffect },
      ]),
    );
  }
}
