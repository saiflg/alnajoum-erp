'use client';

import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  ChevronLeftIcon,
  CloseIcon,
  LogoutIcon,
  MenuIcon,
  NavIcon,
  NavIconName,
} from '@/lib/nav-icons';

export interface NavLink {
  href: string;
  label: string;
  /** Falls back to a generic dot when omitted (a couple of one-off dashboards pass plain link objects). */
  icon?: NavIconName;
}

const SIDEBAR_COLLAPSED_KEY = 'alnajoum:sidebar-collapsed';

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  title,
  navLinks,
  children,
}: {
  title: string;
  navLinks: NavLink[];
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Read the persisted collapse preference after mount only — localStorage
  // isn't available during SSR, and this avoids a hydration mismatch. This
  // is exactly the case an effect exists for (synchronizing with an
  // external, non-React data source that can't be read during render), so
  // the usual "adjust state during render instead" rewrite doesn't apply
  // here — there's no prior render's value to diff against, just a
  // one-time external read on mount.
  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === '1') setCollapsed(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Close the mobile drawer the instant the route changes, using React's
  // documented "adjust state during render" pattern instead of an effect —
  // same fix as admin/manual-payments/page.tsx's customer-select reset.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMobileOpen(false);
  }

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  const sidebarWidth = collapsed ? 76 : 248;

  const navList = (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
      {navLinks.map((link) => {
        const active = isActivePath(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            title={collapsed ? link.label : undefined}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              active ? 'text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            {active && (
              <motion.span
                layoutId="active-nav-pill"
                className="absolute inset-0 rounded-lg bg-gradient-to-r from-amber-500/90 to-amber-600/90 shadow-sm"
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              />
            )}
            {!active && (
              <span className="absolute inset-0 rounded-lg bg-white/0 transition-colors group-hover:bg-white/5" />
            )}
            <NavIcon
              name={link.icon ?? 'dashboard'}
              className="relative z-10 h-5 w-5 shrink-0"
            />
            <span
              className={`relative z-10 truncate transition-opacity duration-150 ${
                collapsed ? 'lg:hidden lg:opacity-0' : 'opacity-100'
              }`}
            >
              {link.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );

  const sidebarInner = (isMobile: boolean) => (
    <div className="flex h-full flex-col bg-slate-900 text-white">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-4">
        <div className={`flex items-center gap-2 overflow-hidden ${collapsed && !isMobile ? 'lg:justify-center' : ''}`}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-sm font-bold text-slate-900">
            AT
          </span>
          <span
            className={`min-w-0 transition-opacity duration-150 ${
              collapsed && !isMobile ? 'lg:hidden lg:opacity-0' : 'opacity-100'
            }`}
          >
            <p className="truncate text-sm font-semibold leading-tight">Alnajoum ERP</p>
            <p className="truncate text-xs text-slate-400">{title}</p>
          </span>
        </div>
        {isMobile && (
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        )}
      </div>

      {navList}

      <div className="border-t border-white/10 p-3">
        {user && (
          <div
            className={`mb-2 flex items-center gap-2 rounded-lg px-2 py-2 ${
              collapsed && !isMobile ? 'lg:justify-center' : ''
            }`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold uppercase">
              {user.email.slice(0, 2)}
            </span>
            <span
              className={`min-w-0 transition-opacity duration-150 ${
                collapsed && !isMobile ? 'lg:hidden lg:opacity-0' : 'opacity-100'
              }`}
            >
              <p className="truncate text-xs font-medium text-slate-100">{user.email}</p>
              <p className="truncate text-[11px] text-slate-400">{user.roles.join(', ')}</p>
            </span>
          </div>
        )}
        <button
          onClick={handleLogout}
          title={collapsed && !isMobile ? 'Log out' : undefined}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white ${
            collapsed && !isMobile ? 'lg:justify-center' : ''
          }`}
        >
          <LogoutIcon className="h-5 w-5 shrink-0" />
          <span
            className={`transition-opacity duration-150 ${
              collapsed && !isMobile ? 'lg:hidden lg:opacity-0' : 'opacity-100'
            }`}
          >
            Log out
          </span>
        </button>
        {!isMobile && (
          <button
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="mt-1 hidden w-full items-center justify-center rounded-lg py-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white lg:flex"
          >
            <ChevronLeftIcon
              className={`h-4 w-4 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {/* Desktop sidebar */}
      <motion.aside
        animate={{ width: sidebarWidth }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="sticky top-0 hidden h-screen shrink-0 lg:block"
      >
        {sidebarInner(false)}
      </motion.aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <div>
          <p className="text-base font-semibold text-slate-900">Alnajoum Travel ERP</p>
          <p className="text-xs text-slate-500">{title}</p>
        </div>
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="rounded-md border border-slate-200 p-2 text-slate-700"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              className="fixed inset-y-0 left-0 z-50 w-72 lg:hidden"
            >
              {sidebarInner(true)}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
