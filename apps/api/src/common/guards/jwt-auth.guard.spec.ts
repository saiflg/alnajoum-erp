import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

const context = (path: string): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ path }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard: a temporary password must be replaced first', () => {
  const guard = new JwtAuthGuard(new Reflector());
  const flagged = { sub: 'i1', mustChangePassword: true };
  const normal = { sub: 'i1', mustChangePassword: false };

  it('lets a person with a temporary password change it, see who they are and sign out', () => {
    for (const path of [
      '/api/v1/auth/change-password',
      '/api/v1/auth/me',
      '/api/v1/auth/logout',
    ]) {
      expect(guard.handleRequest(null, flagged, null, context(path))).toBe(
        flagged,
      );
    }
  });

  it('refuses everything else with PASSWORD_CHANGE_REQUIRED', () => {
    for (const path of [
      '/api/v1/staff',
      '/api/v1/invoices',
      '/api/v1/visa/payouts/x/pay',
    ]) {
      try {
        guard.handleRequest(null, flagged, null, context(path));
        throw new Error('should have been refused');
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(
          JSON.stringify((e as ForbiddenException).getResponse()),
        ).toContain('PASSWORD_CHANGE_REQUIRED');
      }
    }
  });

  it('does not touch anyone who has no temporary password', () => {
    expect(
      guard.handleRequest(null, normal, null, context('/api/v1/staff')),
    ).toBe(normal);
  });
});
