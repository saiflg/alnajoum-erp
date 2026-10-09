import { NotFoundException } from '@nestjs/common';
import { PackageStatus } from '@prisma/client';
import { UmrahPackagesService } from '../umrah/umrah-packages.service';
import { HajjPackagesService } from './hajj-packages.service';

/** The public package detail endpoint must not expose drafts or closed packages, or internal costs (S-40). */
interface Case {
  name: string;
  model: string;
  secrets: string[];
  make: (prisma: unknown) => {
    findOnePublished(id: string): Promise<unknown>;
  };
}

const cases: Case[] = [
  {
    name: 'hajj',
    model: 'hajjPackage',
    secrets: ['internalCost'],
    make: (p) => new HajjPackagesService(p as never, {} as never),
  },
  {
    name: 'umrah',
    model: 'umrahPackage',
    secrets: ['costPrice', 'incentiveRule'],
    make: (p) => new UmrahPackagesService(p as never, {} as never),
  },
];

describe.each(cases)('public $name package detail', (c) => {
  const prismaWith = (status: PackageStatus) => ({
    [c.model]: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'p1',
        status,
        internalCost: 1,
        costPrice: 1,
        incentiveRule: 'x',
      }),
    },
  });

  it('returns a PUBLISHED package without its internal cost', async () => {
    const result = await c
      .make(prismaWith(PackageStatus.PUBLISHED))
      .findOnePublished('p1');
    expect(result).toMatchObject({ id: 'p1' });
    for (const secret of c.secrets) expect(result).not.toHaveProperty(secret);
  });

  it.each([PackageStatus.DRAFT, PackageStatus.CLOSED, PackageStatus.CANCELLED])(
    'answers 404 for a %s package',
    async (status) => {
      await expect(
        c.make(prismaWith(status)).findOnePublished('p1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );
});
