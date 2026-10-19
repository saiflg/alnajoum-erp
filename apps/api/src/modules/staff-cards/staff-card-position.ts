/** What the card shows as the holder's position when no job title has been typed in: their role, in plain words. */
const ROLE_POSITION: Record<string, string> = {
  SUPER_ADMIN: 'Super Administrator',
  COMPANY_ADMIN: 'Company Administrator',
  BRANCH_MANAGER: 'Branch Manager',
  FINANCE_OFFICER: 'Finance Officer',
  AUDITOR: 'Auditor',
  STAFF: 'Staff',
};

const titleCase = (name: string): string =>
  name
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

/**
 * The position printed on an identification card: the job title the company typed for the person (CEO, Senior Travel
 * Consultant ...), otherwise their role (Branch Manager ...). Nothing is made up: with neither, no position is printed.
 */
export function positionFor(
  jobTitle: string | null | undefined,
  roleNames: string[],
): string | null {
  const title = jobTitle?.trim();
  if (title) return title;
  const role = roleNames.find((r) => r !== 'CUSTOMER');
  if (!role) return null;
  return ROLE_POSITION[role] ?? titleCase(role);
}
