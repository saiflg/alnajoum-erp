import { ConfigService } from '@nestjs/config';
import { IdentityType } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RbacService } from '../../rbac/rbac.service';
import { JwtAccessStrategy } from './jwt-access.strategy';

describe('JwtAccessStrategy', () => {
  let strategy: JwtAccessStrategy;
  let rbacService: { getEffectiveAccess: jest.Mock };
  let prisma: {
    staff: { findUnique: jest.Mock };
    customer: { findUnique: jest.Mock };
  };

  beforeEach(() => {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('test-secret'),
    } as unknown as ConfigService;
    rbacService = {
      getEffectiveAccess: jest.fn().mockResolvedValue({
        roles: ['SUPER_ADMIN'],
        permissions: ['flight:book', 'flight:void'],
      }),
    };
    prisma = {
      staff: {
        findUnique: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
      },
      customer: { findUnique: jest.fn() },
    };
    strategy = new JwtAccessStrategy(
      configService,
      rbacService as unknown as RbacService,
      prisma as unknown as PrismaService,
    );
  });

  /**
   * Spec: a role with a large permission set (SUPER_ADMIN/COMPANY_ADMIN)
   * must never blow the access_token cookie past the ~4KB limit browsers
   * silently enforce per cookie — see the strategy's own doc comment. The
   * fix is that the signed payload never carries `permissions` at all;
   * validate() must resolve it fresh from RbacService instead of trusting
   * anything the token might (or might not) already contain.
   */
  it('resolves permissions from RbacService rather than from the token payload', async () => {
    const payload = {
      sub: 'identity-1',
      type: IdentityType.STAFF,
      roles: ['SUPER_ADMIN'],
    };

    const result = await strategy.validate(payload);

    expect(rbacService.getEffectiveAccess).toHaveBeenCalledWith('identity-1');
    expect(result).toEqual({
      sub: 'identity-1',
      type: IdentityType.STAFF,
      roles: ['SUPER_ADMIN'],
      permissions: ['flight:book', 'flight:void'],
      companyId: 'company-1',
      sessionId: null,
    });
  });

  it("carries sessionId through and bumps that session's lastActivityAt", async () => {
    const payload = {
      sub: 'identity-1',
      type: IdentityType.STAFF,
      roles: ['STAFF'],
      sessionId: 'session-1',
    };
    const prismaWithRefreshToken = prisma as unknown as {
      refreshToken: { update: jest.Mock };
    };
    prismaWithRefreshToken.refreshToken = {
      update: jest.fn().mockResolvedValue({}),
    };

    const result = await strategy.validate(payload);

    expect(result.sessionId).toBe('session-1');
    expect(prismaWithRefreshToken.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { lastActivityAt: expect.any(Date) },
    });
  });

  it('resolves companyId from Customer for a CUSTOMER identity', async () => {
    prisma.customer.findUnique.mockResolvedValue({ companyId: 'company-2' });
    const payload = {
      sub: 'identity-2',
      type: IdentityType.CUSTOMER,
      roles: ['CUSTOMER'],
    };

    const result = await strategy.validate(payload);

    expect(prisma.customer.findUnique).toHaveBeenCalledWith({
      where: { identityId: 'identity-2' },
      select: { companyId: true },
    });
    expect(prisma.staff.findUnique).not.toHaveBeenCalled();
    expect(result.companyId).toBe('company-2');
  });

  it('ignores a `permissions` field even if one is somehow present on the decoded payload', async () => {
    const payload = {
      sub: 'identity-1',
      type: IdentityType.STAFF,
      roles: ['STAFF'],
      permissions: ['forged:permission'],
    };

    const result = await strategy.validate(payload);

    expect(result.permissions).toEqual(['flight:book', 'flight:void']);
  });
});
