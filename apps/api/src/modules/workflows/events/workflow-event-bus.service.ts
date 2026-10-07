import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ChainContext, rootChain } from '../engine/loop-guard';
import { jsonSize, redact } from '../engine/redact';

/** Emitted (in-process) after an event is durably stored; the dispatcher listens for it. */
export const WORKFLOW_EVENT_PUBLISHED = 'workflow.event.published';

export const EVENT_TYPE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/;
export const MAX_PAYLOAD_BYTES = 64 * 1024;
/** Top-level payload keys the engine reserves for its own context. */
const RESERVED_KEYS = new Set(['event', 'steps', 'workflow']);

export class EventValidationError extends Error {}

export interface PublishInput {
  /** `<domain>.<fact>` in lower snake case, e.g. `booking.confirmed`, `visa.document_missing`. */
  type: string;
  /** The module that emitted it, e.g. `flights`. */
  source: string;
  companyId?: string | null;
  branchId?: string | null;
  actorIdentityId?: string | null;
  entityType?: string;
  entityId?: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  /**
   * Makes publishing idempotent: the same business fact published twice (a retry, a
   * replayed webhook, a re-run job) is ONE event. Build it from what makes the fact
   * unique, e.g. `payment.succeeded:${paymentId}`.
   */
  dedupeKey?: string;
  chain?: ChainContext;
  occurredAt?: Date;
}

export interface PublishResult {
  eventId: string;
  duplicate: boolean;
}

/**
 * Phase 21 — the domain-event bus.
 *
 * The audit found one in-process event and nothing durable: an event was lost on a
 * crash and could not be replayed. This bus stores every event first (the
 * outbox), then notifies the dispatcher; if the process dies in between, the
 * scheduler's sweep finds the still-PENDING event and dispatches it. Matching a
 * workflow to an event is idempotent (one execution per workflow per event), so
 * dispatching twice is harmless.
 */
@Injectable()
export class WorkflowEventBus {
  private readonly logger = new Logger(WorkflowEventBus.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
  ) {}

  async publish(input: PublishInput): Promise<PublishResult> {
    if (!EVENT_TYPE_RE.test(input.type))
      throw new EventValidationError(
        `Invalid event type "${input.type}" — use lower snake case like booking.confirmed`,
      );
    if (!/^[a-z][a-z0-9_.-]{0,40}$/.test(input.source))
      throw new EventValidationError(`Invalid event source "${input.source}"`);
    if (
      !input.payload ||
      typeof input.payload !== 'object' ||
      Array.isArray(input.payload)
    )
      throw new EventValidationError('An event payload must be an object');

    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(redact(input.payload)))
      if (!RESERVED_KEYS.has(k)) payload[k] = v;
    if (jsonSize(payload) > MAX_PAYLOAD_BYTES)
      throw new EventValidationError(
        `Event payload is larger than ${MAX_PAYLOAD_BYTES / 1024} KB; send ids, not whole records`,
      );

    const data: Prisma.WorkflowEventUncheckedCreateInput = {
      type: input.type,
      source: input.source,
      companyId: input.companyId ?? null,
      branchId: input.branchId ?? null,
      actorIdentityId: input.actorIdentityId ?? null,
      correlationId: input.correlationId ?? randomUUID(),
      entityType: input.entityType,
      entityId: input.entityId,
      payload: payload as Prisma.InputJsonValue,
      chain: (input.chain ?? rootChain()) as unknown as Prisma.InputJsonValue,
      dedupeKey: input.dedupeKey,
      occurredAt: input.occurredAt ?? new Date(),
    };

    let eventId: string;
    try {
      eventId = (
        await this.prisma.workflowEvent.create({ data, select: { id: true } })
      ).id;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        input.dedupeKey
      ) {
        const existing = await this.prisma.workflowEvent.findUnique({
          where: { dedupeKey: input.dedupeKey },
          select: { id: true },
        });
        if (existing) return { eventId: existing.id, duplicate: true };
      }
      throw e;
    }
    // Notify after the event is safely stored. Not awaited: a slow workflow must never slow the publisher.
    setImmediate(() => {
      try {
        this.emitter.emit(WORKFLOW_EVENT_PUBLISHED, { eventId });
      } catch (err) {
        this.logger.warn(
          `Dispatch notification failed for ${eventId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
    return { eventId, duplicate: false };
  }

  /**
   * For domain code: publish and never fail the caller. A booking must not be rejected
   * because automation was unavailable — the failure is logged and visible, not fatal.
   */
  async publishSafe(input: PublishInput): Promise<void> {
    try {
      await this.publish(input);
    } catch (e) {
      this.logger.error(
        `Could not publish ${input.type}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
