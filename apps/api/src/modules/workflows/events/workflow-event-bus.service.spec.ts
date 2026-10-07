import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import {
  EventValidationError,
  MAX_PAYLOAD_BYTES,
  WORKFLOW_EVENT_PUBLISHED,
  WorkflowEventBus,
} from './workflow-event-bus.service';

function setup() {
  const created: unknown[] = [];
  const prisma = {
    workflowEvent: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({ id: 'ev-1' });
      }),
      findUnique: jest.fn().mockResolvedValue({ id: 'ev-existing' }),
    },
  };
  const emitter = { emit: jest.fn() };
  const bus = new WorkflowEventBus(
    prisma as never,
    emitter as unknown as EventEmitter2,
  );
  return { bus, prisma, emitter, created };
}

const base = {
  type: 'booking.confirmed',
  source: 'flights',
  companyId: 'co-A',
  payload: { booking: { reference: 'ANJ-1' } },
};
const flush = () => new Promise((r) => setImmediate(r));

describe('WorkflowEventBus.publish', () => {
  it('stores the event first, then notifies the dispatcher', async () => {
    const { bus, emitter, prisma } = setup();
    const r = await bus.publish(base);
    expect(r).toEqual({ eventId: 'ev-1', duplicate: false });
    expect(prisma.workflowEvent.create).toHaveBeenCalledTimes(1);
    expect(emitter.emit).not.toHaveBeenCalled(); // not before the caller regains control
    await flush();
    expect(emitter.emit).toHaveBeenCalledWith(WORKFLOW_EVENT_PUBLISHED, {
      eventId: 'ev-1',
    });
  });
  it('gives every event an id, a correlation id, a schema-versioned payload and a fresh chain', async () => {
    const { bus, created } = setup();
    await bus.publish(base);
    const row = created[0] as Record<string, unknown>;
    expect(row.correlationId).toMatch(/[0-9a-f-]{36}/);
    expect(row.chain).toEqual({ workflowChain: [], eventChain: [] });
    expect(row.companyId).toBe('co-A');
  });
  it('keeps a supplied correlation id and chain (so a cascade stays traceable and loop-checked)', async () => {
    const { bus, created } = setup();
    await bus.publish({
      ...base,
      correlationId: 'corr-9',
      chain: { workflowChain: ['wfA'], eventChain: ['ev0'] },
    });
    expect(created[0]).toMatchObject({
      correlationId: 'corr-9',
      chain: { workflowChain: ['wfA'], eventChain: ['ev0'] },
    });
  });
  it('is idempotent on dedupeKey: the same fact published twice is one event', async () => {
    const { bus, prisma } = setup();
    prisma.workflowEvent.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    const r = await bus.publish({ ...base, dedupeKey: 'payment.succeeded:p1' });
    expect(r).toEqual({ eventId: 'ev-existing', duplicate: true });
  });
  it('does not swallow other database errors', async () => {
    const { bus, prisma } = setup();
    prisma.workflowEvent.create.mockRejectedValueOnce(new Error('db down'));
    await expect(bus.publish(base)).rejects.toThrow('db down');
  });
  it('redacts secrets before storing, and strips keys the engine reserves', async () => {
    const { bus, created } = setup();
    await bus.publish({
      ...base,
      payload: {
        customer: { name: 'A', passportNumber: 'A123' },
        token: 't',
        event: 'spoof',
        steps: { x: 1 },
        workflow: 'w',
      },
    });
    const stored = (created[0] as { payload: Record<string, unknown> }).payload;
    expect(stored).toEqual({
      customer: { name: 'A', passportNumber: '[REDACTED]' },
      token: '[REDACTED]',
    });
  });
  it('rejects malformed types, sources and payloads', async () => {
    const { bus } = setup();
    for (const type of [
      'Booking.Confirmed',
      'booking',
      'booking..x',
      'x.y.z.w.v',
      '',
      'booking.confirmed; DROP',
    ]) {
      await expect(bus.publish({ ...base, type })).rejects.toBeInstanceOf(
        EventValidationError,
      );
    }
    await expect(
      bus.publish({ ...base, source: 'Bad Source' }),
    ).rejects.toBeInstanceOf(EventValidationError);
    await expect(
      bus.publish({ ...base, payload: [] as never }),
    ).rejects.toBeInstanceOf(EventValidationError);
    await expect(
      bus.publish({ ...base, payload: null as never }),
    ).rejects.toBeInstanceOf(EventValidationError);
  });
  it('rejects an oversized payload', async () => {
    const { bus } = setup();
    await expect(
      bus.publish({
        ...base,
        payload: { blob: 'x'.repeat(MAX_PAYLOAD_BYTES + 10) },
      }),
    ).rejects.toThrow(/larger than/);
  });
});

describe('WorkflowEventBus.publishSafe', () => {
  it('never throws into the domain code that called it', async () => {
    const { bus, prisma } = setup();
    prisma.workflowEvent.create.mockRejectedValueOnce(new Error('db down'));
    await expect(bus.publishSafe(base)).resolves.toBeUndefined();
    await expect(
      bus.publishSafe({ ...base, type: 'NOPE' }),
    ).resolves.toBeUndefined();
  });
});
