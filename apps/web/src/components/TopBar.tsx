'use client';

import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import { Notification } from '@/lib/types';
import {
  CheckIcon,
  ChevronDownIcon,
  GlobeIcon,
  LogoutIcon,
  MenuIcon,
  NavIcon,
} from '@/lib/nav-icons';

type OpenMenu = 'notifications' | 'language' | 'profile' | null;

const LANGUAGES = [
  { code: 'en', label: 'English', available: true },
  { code: 'ha', label: 'Hausa', available: false },
  { code: 'ar', label: 'العربية (Arabic)', available: false },
];

/** Fetched once on mount and again whenever the notification menu opens — no
 * need for real-time polling infrastructure for what's currently a modest
 * volume of staff/customer notifications. */
function useOwnNotifications(open: boolean) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiRequest<Notification[]>('/notifications/me')
      .then(setNotifications)
      .catch(() => setError('Failed to load notifications'));
  }

  useEffect(load, []);
  useEffect(() => {
    if (open) load();
  }, [open]);

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    try {
      await apiRequest(`/notifications/me/${id}/read`, { method: 'PATCH' });
    } catch {
      // Non-critical — a failed mark-read just means it'll still show
      // unread next time; not worth surfacing an error for.
    }
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await apiRequest('/notifications/me/read-all', { method: 'PATCH' });
    } catch {
      // Same as above.
    }
  }

  return { notifications, error, markRead, markAllRead };
}

export function TopBar({
  title,
  agencyName,
  onOpenMobileMenu,
}: {
  title: string;
  agencyName: string;
  onOpenMobileMenu: () => void;
}) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { notifications, error, markRead, markAllRead } = useOwnNotifications(
    openMenu === 'notifications',
  );
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  const accountHref = user?.type === 'STAFF' ? '/admin/account' : '/portal/profile';
  const initials = user?.email.slice(0, 2).toUpperCase() ?? '';

  return (
    <div
      ref={containerRef}
      className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 lg:px-8"
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onOpenMobileMenu}
          aria-label="Open menu"
          className="shrink-0 rounded-md border border-slate-200 p-2 text-slate-700 lg:hidden"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-amber-600">
            {agencyName}
          </p>
          <h1 className="truncate text-base font-semibold text-slate-900 sm:text-lg">{title}</h1>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {/* Language */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu((m) => (m === 'language' ? null : 'language'))}
            aria-label="Change language"
            className="flex items-center gap-1 rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <GlobeIcon className="h-5 w-5" />
            <span className="hidden text-xs font-medium sm:inline">EN</span>
          </button>
          <AnimatePresence>
            {openMenu === 'language' && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 z-40 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg"
              >
                <p className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Language
                </p>
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    disabled={!lang.available}
                    onClick={() => setOpenMenu(null)}
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm ${
                      lang.available
                        ? 'text-slate-700 hover:bg-slate-100'
                        : 'cursor-not-allowed text-slate-300'
                    }`}
                  >
                    <span>{lang.label}</span>
                    {lang.available ? (
                      <CheckIcon className="h-4 w-4 text-amber-600" />
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                        Coming soon
                      </span>
                    )}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu((m) => (m === 'notifications' ? null : 'notifications'))}
            aria-label="Notifications"
            className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <NavIcon name="bell" className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          <AnimatePresence>
            {openMenu === 'notifications' && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 z-40 mt-2 w-80 rounded-lg border border-slate-200 bg-white shadow-lg"
              >
                <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5">
                  <p className="text-sm font-semibold text-slate-900">Notifications</p>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="text-xs font-medium text-amber-700 hover:underline"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {error && <p className="p-3.5 text-sm text-red-600">{error}</p>}
                  {!error && notifications.length === 0 && (
                    <p className="p-3.5 text-sm text-slate-500">No notifications yet.</p>
                  )}
                  {notifications.slice(0, 10).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => markRead(n.id)}
                      className={`block w-full border-b border-slate-50 px-3.5 py-2.5 text-left last:border-0 hover:bg-slate-50 ${
                        n.isRead ? '' : 'bg-amber-50/60'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {!n.isRead && (
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                        )}
                        <div className={`min-w-0 ${n.isRead ? 'pl-3.5' : ''}`}>
                          <p className="truncate text-sm font-medium text-slate-900">
                            {n.subject}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {formatDateTime(n.createdAt)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                {user?.type === 'CUSTOMER' && (
                  <Link
                    href="/portal/notifications"
                    onClick={() => setOpenMenu(null)}
                    className="block border-t border-slate-100 px-3.5 py-2.5 text-center text-sm font-medium text-amber-700 hover:bg-slate-50"
                  >
                    View all
                  </Link>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Profile */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu((m) => (m === 'profile' ? null : 'profile'))}
            className="flex items-center gap-1.5 rounded-md py-1 pl-1 pr-2 hover:bg-slate-100"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">
              {initials}
            </span>
            <ChevronDownIcon className="hidden h-4 w-4 text-slate-400 sm:block" />
          </button>
          <AnimatePresence>
            {openMenu === 'profile' && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 z-40 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg"
              >
                {user && (
                  <div className="border-b border-slate-100 px-2.5 py-2.5">
                    <p className="truncate text-sm font-medium text-slate-900">{user.email}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{user.roles.join(', ')}</p>
                  </div>
                )}
                <Link
                  href={accountHref}
                  onClick={() => setOpenMenu(null)}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  <NavIcon name="account" className="h-4 w-4" />
                  My Account
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  <LogoutIcon className="h-4 w-4" />
                  Log out
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
