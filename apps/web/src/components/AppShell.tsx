'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

interface NavLink {
  href: string;
  label: string;
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

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-lg font-semibold text-slate-900">Alnajoum Travel ERP</p>
            <p className="text-xs text-slate-500">{title}</p>
          </div>
          <div className="flex items-center gap-4">
            {user && (
              <div className="text-right text-sm">
                <p className="font-medium text-slate-800">{user.email}</p>
                <p className="text-xs text-slate-500">{user.roles.join(', ')}</p>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Log out
            </button>
          </div>
        </div>
        {navLinks.length > 0 && (
          <nav className="mx-auto flex max-w-6xl gap-1 px-6 pb-3">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
