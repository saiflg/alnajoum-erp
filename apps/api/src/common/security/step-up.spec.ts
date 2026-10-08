import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  RequireStepUp,
  STEP_UP_AUDIENCE,
  STEP_UP_HEADER,
  STEP_UP_KEY,
  StepUpGuard,
  StepUpRequiredException,
} from './step-up';

const SECRET = 'unit-test-secret-unit-test-secret-1234';
const jwt = new JwtService({ secret: SECRET });

function make(opts: {
  required: boolean;
  user?: { sub: string };
  headers?: Record<string, string>;
}) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === STEP_UP_KEY ? opts.required : undefined,
    ),
  } as unknown as Reflector;
  const config = { getOrThrow: () => SECRET } as unknown as ConfigService;
  const guard = new StepUpGuard(reflector, config);
  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ user: opts.user, headers: opts.headers ?? {} }),
    }),
  } as unknown as ExecutionContext;
  return { guard, context };
}
const token = (
  sub: string,
  extra: Record<string, unknown> = {},
  options: Record<string, unknown> = {},
) =>
  jwt.signAsync(
    { sub, ...extra },
    { audience: STEP_UP_AUDIENCE, expiresIn: 300, ...options },
  );

describe('StepUpGuard', () => {
  it('does nothing on routes that do not ask for step-up', async () => {
    const { guard, context } = make({ required: false, user: { sub: 'u1' } });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('refuses a sensitive route with no proof, with a machine-readable code', async () => {
    const { guard, context } = make({ required: true, user: { sub: 'u1' } });
    const err = (await guard
      .canActivate(context)
      .catch((e: unknown) => e)) as StepUpRequiredException;
    expect(err).toBeInstanceOf(StepUpRequiredException);
    expect(err.getResponse()).toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });

  it('accepts a fresh proof that belongs to the signed-in user', async () => {
    const { guard, context } = make({
      required: true,
      user: { sub: 'u1' },
      headers: { [STEP_UP_HEADER]: await token('u1') },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("rejects another user's proof", async () => {
    const { guard, context } = make({
      required: true,
      user: { sub: 'u1' },
      headers: { [STEP_UP_HEADER]: await token('someone-else') },
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      StepUpRequiredException,
    );
  });

  it('rejects an expired proof', async () => {
    const expired = await token('u1', {}, { expiresIn: -10 });
    const { guard, context } = make({
      required: true,
      user: { sub: 'u1' },
      headers: { [STEP_UP_HEADER]: expired },
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      StepUpRequiredException,
    );
  });

  it('rejects a normal access token presented as proof (wrong audience) and garbage', async () => {
    const access = await jwt.signAsync({ sub: 'u1' }, { expiresIn: 300 });
    for (const bad of [access, 'not-a-jwt']) {
      const { guard, context } = make({
        required: true,
        user: { sub: 'u1' },
        headers: { [STEP_UP_HEADER]: bad },
      });
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        StepUpRequiredException,
      );
    }
  });

  it('rejects a proof signed with a different secret', async () => {
    const forged = await new JwtService({
      secret: 'another-secret-another-secret-123456',
    }).signAsync({ sub: 'u1' }, { audience: STEP_UP_AUDIENCE, expiresIn: 300 });
    const { guard, context } = make({
      required: true,
      user: { sub: 'u1' },
      headers: { [STEP_UP_HEADER]: forged },
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      StepUpRequiredException,
    );
  });

  it('RequireStepUp marks the route', () => {
    class C {
      @RequireStepUp()
      m() {
        return 1;
      }
    }
    expect(
      Reflect.getMetadata(
        STEP_UP_KEY,
        Object.getOwnPropertyDescriptor(C.prototype, 'm')?.value,
      ),
    ).toBe(true);
  });
});
