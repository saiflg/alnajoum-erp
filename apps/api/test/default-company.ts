import request from 'supertest';

/**
 * Self-registered customers always land in the platform's first (oldest active) company, so staff that must see
 * those customers' records have to belong to the same company: with tenant isolation a staff member of any
 * other company correctly gets 404.
 */
export async function defaultCompanyId(
  server: Parameters<typeof request>[0],
  superAdminToken: string,
): Promise<string> {
  const res = await request(server)
    .get('/api/v1/companies')
    .set('Authorization', `Bearer ${superAdminToken}`)
    .expect(200);
  const rows = (
    res.body.data as { id: string; createdAt: string; isActive?: boolean }[]
  )
    .filter((c) => c.isActive !== false)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return rows[0].id;
}
