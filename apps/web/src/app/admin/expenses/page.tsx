'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';

type ExpenseStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';

interface Expense {
  id: string;
  expenseNumber: string;
  category: string;
  amount: number;
  currency: string;
  date: string;
  description: string;
  vendor: string | null;
  status: ExpenseStatus;
  createdByStaff: { firstName: string; lastName: string } | null;
  approvedByStaff: { firstName: string; lastName: string } | null;
  branch: { name: string } | null;
}

const CATEGORIES = ['Staff Expenses', 'Office Expenses', 'Marketing', 'Hosting', 'API Costs', 'Bank Charges', 'Other Expenses'];

const STATUS_STYLES: Record<ExpenseStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  REJECTED: 'bg-red-100 text-red-800',
  PAID: 'bg-emerald-100 text-emerald-800',
};

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<ExpenseStatus | ''>('');
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState(CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [vendor, setVendor] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    const params = statusFilter ? `?status=${statusFilter}` : '';
    apiRequest<Expense[]>(`/finance/expenses${params}`)
      .then(setExpenses)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load expenses'));
  }

  useEffect(load, [statusFilter]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/finance/expenses', {
        method: 'POST',
        body: { category, amount: Number(amount), date, description, vendor: vendor || undefined },
      });
      setAmount('');
      setDescription('');
      setVendor('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record expense');
    } finally {
      setSubmitting(false);
    }
  }

  async function act(id: string, action: 'approve' | 'reject' | 'pay') {
    setBusyId(id);
    setError(null);
    try {
      await apiRequest(`/finance/expenses/${id}/${action}`, { method: 'POST', body: {} });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to ${action} expense`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'FINANCE_OFFICER']}>
      <AppShell title="Expenses" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Expense Management</h2>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <form onSubmit={handleCreate} className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs text-slate-500">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Amount (NGN)
            <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} required className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            Vendor
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500 lg:col-span-1">
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} required className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <div className="sm:col-span-2 lg:col-span-5">
            <button type="submit" disabled={submitting} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              Record expense
            </button>
          </div>
        </form>

        <div className="mt-6 flex gap-2">
          {(['', 'PENDING', 'APPROVED', 'REJECTED', 'PAID'] as const).map((s) => (
            <button
              key={s || 'ALL'}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${statusFilter === s ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Expense #</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Category</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Description</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Amount</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Date</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {expenses?.map((exp) => (
                <tr key={exp.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">{exp.expenseNumber}</td>
                  <td className="px-3 py-2 text-slate-600">{exp.category}</td>
                  <td className="px-3 py-2 text-slate-600">{exp.description}</td>
                  <td className="px-3 py-2 text-right text-slate-800">{formatCurrency(exp.amount, exp.currency)}</td>
                  <td className="px-3 py-2 text-slate-500">{formatDateTime(exp.date)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[exp.status]}`}>{exp.status}</span>
                  </td>
                  <td className="px-3 py-2">
                    {exp.status === 'PENDING' && (
                      <div className="flex gap-2">
                        <button disabled={busyId === exp.id} onClick={() => act(exp.id, 'approve')} className="text-emerald-600 hover:underline disabled:opacity-50">
                          Approve
                        </button>
                        <button disabled={busyId === exp.id} onClick={() => act(exp.id, 'reject')} className="text-red-600 hover:underline disabled:opacity-50">
                          Reject
                        </button>
                      </div>
                    )}
                    {exp.status === 'APPROVED' && (
                      <button disabled={busyId === exp.id} onClick={() => act(exp.id, 'pay')} className="text-blue-600 hover:underline disabled:opacity-50">
                        Mark paid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {expenses?.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                    No expenses recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
