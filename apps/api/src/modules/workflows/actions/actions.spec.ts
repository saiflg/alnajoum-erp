import { ActionError } from '../engine/retry';
import { renderTemplate } from '../engine/template';
import { ActionContext } from './action.types';
import { AuditNoteAction } from './audit-note.action';
import { EmitEventAction } from './emit-event.action';
import { NotifyAction, WhatsAppNotifyAction } from './notify.actions';
import { TaskCreateAction } from './task-create.action';
import { TimelineAction } from './timeline.action';

type Row = Record<string, any>;

function ctx(
  config: Row,
  context: Row = {},
  over: Partial<ActionContext> = {},
): ActionContext {
  const full = {
    customer: { id: 'c1', preferredLanguage: 'en' },
    booking: { reference: 'ANJ-1' },
    event: { entityType: 'Booking', entityId: 'b1' },
    ...context,
  };
  return {
    executionId: 'ex1',
    nodeId: 'n1',
    idempotencyKey: 'ex:ex1:node:n1',
    mode: 'LIVE',
    companyId: 'co-A',
    branchId: null,
    context: full,
    config,
    chain: { workflowChain: ['wf1'], eventChain: ['e1'] },
    correlationId: 'corr',
    ownerIdentityId: 'owner',
    render: (t: string) => renderTemplate(t, full),
    ...over,
  };
}

describe('task.create', () => {
  const setup = (over: Row = {}) => {
    const prisma = {
      staff: { findFirst: jest.fn(() => Promise.resolve({ id: 'staff1' })) },
      customer: {
        findFirst: jest.fn(() =>
          Promise.resolve({ id: 'c1', assignedStaffId: 'owner-staff' }),
        ),
      },
      ...over,
    };
    const tasks = {
      createAuto: jest.fn(() => Promise.resolve({ id: 'task1' })),
    };
    return {
      a: new TaskCreateAction(prisma as never, tasks as never),
      prisma,
      tasks,
    };
  };
  const cfg = (assignTo: Row): Row => ({
    title: 'Chase {{booking.reference}}',
    assignTo,
  });

  it('validates its configuration', () => {
    const { a } = setup();
    expect(
      a.validate({ title: 'x', assignTo: { mode: 'STAFF', staffId: 's' } }),
    ).toEqual([]);
    expect(a.validate({})).toEqual(
      expect.arrayContaining(['title is required']),
    );
    expect(a.validate({ title: 'x', assignTo: { mode: 'ROLE' } })[0]).toContain(
      'role',
    );
    expect(
      a.validate({
        title: 'x',
        assignTo: { mode: 'STAFF', staffId: 's' },
        relatedType: 'NOPE',
      })[0],
    ).toContain('relatedType');
    expect(
      a.validate({
        title: 'x',
        assignTo: { mode: 'STAFF', staffId: 's' },
        dueInHours: -1,
      })[0],
    ).toContain('dueInHours');
    expect(
      a.validate({ title: 'x', assignTo: { mode: 'EVERYONE' } })[0],
    ).toContain('assignTo.mode');
  });
  it("assigns only to ACTIVE staff of the workflow's own company", async () => {
    const t = setup();
    await t.a.run(ctx(cfg({ mode: 'STAFF', staffId: 'staff1' })));
    expect(t.prisma.staff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'staff1', companyId: 'co-A', isActive: true },
      }),
    );
  });
  it("refuses another company's staff member (permanent, not retried)", async () => {
    const t = setup({
      staff: { findFirst: jest.fn(() => Promise.resolve(null)) },
    });
    await expect(
      t.a.run(ctx(cfg({ mode: 'STAFF', staffId: 'staff-of-B' }))),
    ).rejects.toMatchObject({ kind: 'PERMANENT', code: 'ASSIGNEE_NOT_FOUND' });
    expect(t.tasks.createAuto).not.toHaveBeenCalled();
  });
  it("a role assignment only searches the company, and the event's branch when there is one", async () => {
    const t = setup();
    await t.a.run(
      ctx(
        cfg({ mode: 'ROLE', role: 'FINANCE_OFFICER' }),
        {},
        { branchId: 'br-1' },
      ),
    );
    const where = (
      t.prisma.staff.findFirst.mock.calls[0] as unknown as [{ where: Row }]
    )[0].where;
    expect(where).toMatchObject({
      companyId: 'co-A',
      isActive: true,
      branchId: 'br-1',
      identity: { roles: { some: { role: { name: 'FINANCE_OFFICER' } } } },
    });
  });
  it("assigns to the customer's own staff member, looked up inside the company", async () => {
    const t = setup();
    await t.a.run(ctx(cfg({ mode: 'CUSTOMER_OWNER' })));
    expect(t.prisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', companyId: 'co-A' } }),
    );
    expect(t.tasks.createAuto).toHaveBeenCalledWith(
      expect.objectContaining({ assignedStaffId: 'owner-staff' }),
    );
  });
  it('rejects a customer from another company', async () => {
    const t = setup();
    t.prisma.customer.findFirst.mockResolvedValue(null as never);
    await expect(
      t.a.run(
        ctx({
          ...cfg({ mode: 'STAFF', staffId: 'staff1' }),
          customerId: 'cust-of-B',
        }),
      ),
    ).rejects.toMatchObject({ code: 'CROSS_TENANT' });
  });
  it('renders the title, uses the step key as the dedupe key and a sensible due date', async () => {
    const t = setup();
    const r = await t.a.run(
      ctx({
        ...cfg({ mode: 'STAFF', staffId: 'staff1' }),
        dueInHours: 2,
        priority: 'HIGH',
      }),
    );
    expect(r).toEqual({ taskId: 'task1', assignedStaffId: 'staff1' });
    const arg = (t.tasks.createAuto.mock.calls[0] as unknown as [Row])[0];
    expect(arg).toMatchObject({
      title: 'Chase ANJ-1',
      relatedId: 'ex:ex1:node:n1',
      priority: 'HIGH',
      customerId: 'c1',
    });
    expect(arg.dueDate.getTime()).toBeGreaterThan(Date.now() + 1.9 * 3_600_000);
  });
  it('a missing template variable is a permanent error, not a blank task title', async () => {
    const t = setup();
    await expect(
      t.a.run(
        ctx(
          {
            title: 'Chase {{booking.nope}}',
            assignTo: { mode: 'STAFF', staffId: 'staff1' },
          },
          {},
          {
            render: (s) => {
              try {
                return renderTemplate(s, {});
              } catch (e) {
                throw new ActionError(
                  (e as Error).message,
                  'PERMANENT',
                  'TEMPLATE',
                );
              }
            },
          },
        ),
      ),
    ).rejects.toMatchObject({ kind: 'PERMANENT', code: 'TEMPLATE' });
  });
  it('mock never creates a task', () => {
    const t = setup();
    expect(
      t.a.mock(ctx(cfg({ mode: 'STAFF', staffId: 'staff1' }))),
    ).toMatchObject({ wouldCreateTask: 'Chase ANJ-1', mocked: true });
    expect(t.tasks.createAuto).not.toHaveBeenCalled();
  });
});

describe('notify.* actions', () => {
  const customer = (over: Row = {}) => ({
    id: 'c1',
    preferredLanguage: 'en',
    identity: { id: 'i1', email: 'a@x.test', phone: '+2348000000000' },
    ...over,
  });
  const setup = (
    channel: 'EMAIL' | 'SMS' | 'PUSH',
    c: Row | null = customer(),
    send: Row = { sent: true },
  ) => {
    const prisma = {
      customer: { findFirst: jest.fn(() => Promise.resolve(c)) },
    };
    const notifications = {
      sendWorkflowMessage: jest.fn(() => Promise.resolve(send)),
    };
    return {
      a: new NotifyAction(channel, prisma as never, notifications as never),
      prisma,
      notifications,
    };
  };
  const cfg = {
    subject: 'Hi {{booking.reference}}',
    body: 'Booking {{booking.reference}} confirmed',
  };

  it("looks the customer up INSIDE the workflow's company, never trusting the id alone", async () => {
    const t = setup('EMAIL');
    await t.a.run(ctx(cfg));
    expect(t.prisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', companyId: 'co-A' } }),
    );
  });
  it('refuses a customer who belongs to another company', async () => {
    const t = setup('EMAIL', null);
    await expect(t.a.run(ctx(cfg))).rejects.toMatchObject({
      kind: 'PERMANENT',
      code: 'CROSS_TENANT',
    });
    expect(t.notifications.sendWorkflowMessage).not.toHaveBeenCalled();
  });
  it('sends through the idempotent sender with the step key, to the right contact per channel', async () => {
    const email = setup('EMAIL');
    await email.a.run(ctx(cfg));
    expect(email.notifications.sendWorkflowMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        to: 'a@x.test',
        identityId: 'i1',
        subject: 'Hi ANJ-1',
        body: 'Booking ANJ-1 confirmed',
        idempotencyKey: 'ex:ex1:node:n1',
      }),
    );
    const sms = setup('SMS');
    await sms.a.run(ctx(cfg));
    expect(sms.notifications.sendWorkflowMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'SMS', to: '+2348000000000' }),
    );
  });
  it('treats "no phone", "opted out" and "already sent" as normal outcomes, not errors', async () => {
    for (const reason of [
      'no_recipient',
      'blocked_by_preferences_or_unreachable',
      'already_sent',
    ]) {
      const t = setup('SMS', customer(), { sent: false, reason });
      await expect(t.a.run(ctx(cfg))).resolves.toMatchObject({
        sent: false,
        reason,
      });
    }
  });
  it('a provider failure is RETRYABLE', async () => {
    const t = setup('EMAIL', customer(), {
      sent: false,
      reason: 'smtp timeout',
    });
    await expect(t.a.run(ctx(cfg))).rejects.toMatchObject({
      kind: 'RETRYABLE',
      code: 'PROVIDER_FAILED',
    });
  });
  it("chooses the customer's language and reports text direction (Arabic is right-to-left)", async () => {
    const translations = {
      en: { subject: 'Hello', body: 'Booking {{booking.reference}}' },
      ha: { subject: 'Sannu', body: 'Ajiya {{booking.reference}}' },
      ar: { subject: 'مرحباً', body: 'الحجز {{booking.reference}}' },
    };
    const ar = setup('EMAIL', customer({ preferredLanguage: 'ar' }));
    const r = await ar.a.run(ctx({ translations }));
    expect(r).toMatchObject({ language: 'ar', direction: 'rtl' });
    expect(ar.notifications.sendWorkflowMessage).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'الحجز ANJ-1' }),
    );
    const ha = setup('EMAIL', customer({ preferredLanguage: 'ha' }));
    expect(await ha.a.run(ctx({ translations }))).toMatchObject({
      language: 'ha',
      direction: 'ltr',
    });
    const fr = setup('EMAIL', customer({ preferredLanguage: 'fr' }));
    expect(await fr.a.run(ctx({ translations }))).toMatchObject({
      language: 'en',
    }); // unsupported -> English fallback
  });
  it('validates: body/subject required, translations need English, only known languages', () => {
    const { a } = setup('EMAIL');
    expect(a.validate({ subject: 's', body: 'b' })).toEqual([]);
    expect(a.validate({ body: 'b' })).toContain('subject is required');
    expect(a.validate({ subject: 's' })).toContain('body is required');
    expect(
      a.validate({ translations: { ha: { subject: 's', body: 'b' } } }),
    ).toContain('an English (en) version is required as the fallback');
    expect(
      a.validate({
        translations: {
          fr: { subject: 's', body: 'b' },
          en: { subject: 's', body: 'b' },
        },
      })[0],
    ).toContain('unsupported language');
    expect(setup('SMS').a.validate({ body: 'b' })).toEqual([]); // SMS needs no subject
  });
  it('mock sends nothing but still renders (so test mode catches a missing variable)', () => {
    const t = setup('EMAIL');
    expect(t.a.mock(ctx(cfg))).toMatchObject({
      wouldSend: 'EMAIL',
      body: 'Booking ANJ-1 confirmed',
      mocked: true,
    });
    expect(t.notifications.sendWorkflowMessage).not.toHaveBeenCalled();
    expect(() =>
      t.a.mock(ctx({ subject: 's', body: '{{booking.missing}}' })),
    ).toThrow();
  });
});

describe('notify.whatsapp', () => {
  const setup = (customer: Row | null, res: Row = { sent: true }) => {
    const prisma = {
      customer: { findFirst: jest.fn(() => Promise.resolve(customer)) },
    };
    const whatsapp = {
      sendAutomatedMessage: jest.fn(() => Promise.resolve(res)),
    };
    return {
      a: new WhatsAppNotifyAction(prisma as never, whatsapp as never),
      whatsapp,
    };
  };
  const c = {
    id: 'c1',
    preferredLanguage: 'en',
    identity: { id: 'i1', email: 'a@x.test', phone: '+2348000000000' },
  };

  it('goes through the WhatsApp module, passing the customer id (so its opt-in check applies) and the step key', async () => {
    const t = setup(c);
    await t.a.run(ctx({ body: 'Hello {{booking.reference}}' }));
    expect(t.whatsapp.sendAutomatedMessage).toHaveBeenCalledWith(
      'co-A',
      '+2348000000000',
      'Hello ANJ-1',
      'ex:ex1:node:n1',
      'c1',
    );
  });
  it('does nothing for a customer with no phone', async () => {
    const t = setup({ ...c, identity: { ...c.identity, phone: null } });
    expect(await t.a.run(ctx({ body: 'x' }))).toEqual({
      sent: false,
      reason: 'no_recipient',
    });
    expect(t.whatsapp.sendAutomatedMessage).not.toHaveBeenCalled();
  });
  it('an opt-out is a normal outcome; a send failure is retryable', async () => {
    expect(
      await setup(c, { sent: false, reason: 'opted_out' }).a.run(
        ctx({ body: 'x' }),
      ),
    ).toMatchObject({ sent: false, reason: 'opted_out' });
    await expect(
      setup(c, { sent: false, reason: 'send_failed' }).a.run(
        ctx({ body: 'x' }),
      ),
    ).rejects.toMatchObject({ kind: 'RETRYABLE' });
  });
  it("refuses another company's customer", async () => {
    await expect(setup(null).a.run(ctx({ body: 'x' }))).rejects.toMatchObject({
      code: 'CROSS_TENANT',
    });
  });
});

describe('crm.timeline', () => {
  it('is idempotent per step, tenant-checked, and attached to the right customer', async () => {
    const prisma = {
      customer: { findFirst: jest.fn(() => Promise.resolve({ id: 'c1' })) },
      customerTimelineEvent: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 't1' }),
        create: jest.fn(() => Promise.resolve({ id: 't1' })),
      },
    };
    const a = new TimelineAction(prisma as never);
    expect(
      await a.run(ctx({ description: 'Paid {{booking.reference}}' })),
    ).toEqual({ timelineEventId: 't1' });
    expect(prisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', companyId: 'co-A' } }),
    );
    expect(
      await a.run(ctx({ description: 'Paid {{booking.reference}}' })),
    ).toEqual({ timelineEventId: 't1', deduplicated: true });
    expect(prisma.customerTimelineEvent.create).toHaveBeenCalledTimes(1);
  });
  it('refuses a customer from another company', async () => {
    const a = new TimelineAction({
      customer: { findFirst: jest.fn(() => Promise.resolve(null)) },
    } as never);
    await expect(a.run(ctx({ description: 'x' }))).rejects.toMatchObject({
      code: 'CROSS_TENANT',
    });
  });
});

describe('event.emit (cascades)', () => {
  const setup = () => {
    const bus = {
      publish: jest.fn(() =>
        Promise.resolve({ eventId: 'evNew', duplicate: false }),
      ),
    };
    return { a: new EmitEventAction(bus as never), bus };
  };
  it('only custom.* events can be emitted — a workflow cannot impersonate a real domain event', () => {
    const { a } = setup();
    expect(a.validate({ type: 'custom.refund_review' })).toEqual([]);
    for (const bad of [
      'payment.succeeded',
      'custom.',
      'custom.Bad',
      '',
      undefined,
    ])
      expect(a.validate({ type: bad }).length).toBeGreaterThan(0);
  });
  it("carries the execution's chain, correlation id and company, so loops are caught and the cascade is one trace", async () => {
    const { a, bus } = setup();
    await a.run(
      ctx({
        type: 'custom.refund_review',
        copy: ['booking.reference', 'customer.id'],
      }),
    );
    expect(bus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'custom.refund_review',
        companyId: 'co-A',
        correlationId: 'corr',
        chain: { workflowChain: ['wf1'], eventChain: ['e1'] },
        payload: { booking: { reference: 'ANJ-1' }, customer: { id: 'c1' } },
        dedupeKey: 'emit:ex:ex1:node:n1',
        entityId: 'b1',
      }),
    );
  });
  it('sends ONLY the listed paths, never the whole context', async () => {
    const { a, bus } = setup();
    await a.run(ctx({ type: 'custom.x' }, { secretThing: 'nope' }));
    expect(
      (bus.publish.mock.calls[0] as unknown as [{ payload: Row }])[0].payload,
    ).toEqual({});
  });
  it('is idempotent: re-running the step re-publishes the same dedupe key', async () => {
    const { a, bus } = setup();
    await a.run(ctx({ type: 'custom.x' }));
    await a.run(ctx({ type: 'custom.x' }));
    const keys = (
      bus.publish.mock.calls as unknown as [{ dedupeKey: string }][]
    ).map((c) => c[0].dedupeKey);
    expect(new Set(keys).size).toBe(1);
  });
});

describe('audit.note', () => {
  it('records an audit line attributed to the execution, with the company', async () => {
    const audit = { record: jest.fn(() => Promise.resolve()) };
    await new AuditNoteAction(audit as never).run(
      ctx({ note: 'Reached {{booking.reference}}' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.note',
        entityId: 'ex1',
        companyId: 'co-A',
        reason: 'Reached ANJ-1',
      }),
    );
  });
});

describe('every action', () => {
  it('declares the permissions its author must hold (none is open to anyone)', () => {
    const n = { customer: { findFirst: jest.fn() } } as never;
    const all = [
      new TaskCreateAction(n, {} as never),
      new TimelineAction(n),
      new NotifyAction('EMAIL', n, {} as never),
      new WhatsAppNotifyAction(n, {} as never),
      new AuditNoteAction({} as never),
      new EmitEventAction({} as never),
    ];
    for (const a of all) {
      expect(a.requiredPermissions.length).toBeGreaterThan(0);
      expect(a.key).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
    expect(new Set(all.map((a) => a.key)).size).toBe(all.length);
  });
  it('none of them is a FINANCIAL action — this phase ships no way for a workflow to move money', () => {
    const n = {} as never;
    const all = [
      new TaskCreateAction(n, n),
      new TimelineAction(n),
      new NotifyAction('EMAIL', n, n),
      new WhatsAppNotifyAction(n, n),
      new AuditNoteAction(n),
      new EmitEventAction(n),
    ];
    expect(all.filter((a) => (a.sideEffect as string) === 'FINANCIAL')).toEqual(
      [],
    );
  });
});
