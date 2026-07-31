import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function buildContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows the request when no roles are required', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(buildContext(undefined))).toBe(true);
  });

  it('allows the request when the user holds one of the required roles', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['SUPER_ADMIN', 'COMPANY_ADMIN']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    const context = buildContext({ roles: ['COMPANY_ADMIN'] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws Forbidden when the user holds none of the required roles', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['SUPER_ADMIN']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    const context = buildContext({ roles: ['STAFF'] });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
