import { ConfigService } from '@nestjs/config';
import { IdentityType } from '@prisma/client';
import { RbacService } from '../../rbac/rbac.service';
import { JwtAccessStrategy } from './jwt-access.strategy';

describe('JwtAccessStrategy', () => {
  let strategy: JwtAccessStrategy;
  let rbacService: { getEffectiveAccess: jest.Mock };

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
    strategy = new JwtAccessStrategy(
      configService,
      rbacService as unknown as RbacService,
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
    });
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
