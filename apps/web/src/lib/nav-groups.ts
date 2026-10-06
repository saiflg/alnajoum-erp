import type { NavLink } from '@/components/AppShell';

/**
 * Assigns a menu group to each link by href. Links not listed stay
 * ungrouped (rendered flat, at their original position). Keeping the
 * grouping in one map means the flat link lists below stay easy to scan
 * and a link can be moved between groups without editing the list itself.
 */
export function assignGroups(links: NavLink[], groups: Record<string, string[]>): NavLink[] {
  const byHref = new Map<string, string>();
  for (const [group, hrefs] of Object.entries(groups)) {
    for (const href of hrefs) byHref.set(href, group);
  }
  return links.map((link) => ({ ...link, group: byHref.get(link.href) }));
}
