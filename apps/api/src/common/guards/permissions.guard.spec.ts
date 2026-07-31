import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

function buildContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  it('allows the request when no permissions are required', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(guard.canActivate(buildContext(undefined))).toBe(true);
  });

  it('allows the request when the user holds all required permissions', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['company:read']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    const context = buildContext({ permissions: ['company:read', 'company:update'] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws Forbidden when the user is missing a required permission', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['company:delete']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    const context = buildContext({ permissions: ['company:read'] });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws Forbidden when there is no authenticated user', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['company:read']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
