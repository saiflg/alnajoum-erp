'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency } from '@/lib/format';

interface RoomType {
  id: string;
  name: string;
  category: string;
  capacity: number;
  mealPlan: string;
  supplierCost: number;
  sellingPrice: number;
  currency: string;
  totalRooms: number;
  isActive: boolean;
}

interface Hotel {
  id: string;
  name: string;
  city: string;
  country: string;
  starRating: number;
  status: string;
  roomTypes: RoomType[];
}

const EMPTY_HOTEL_FORM = { name: '', city: '', country: '', starRating: '5' };
const EMPTY_ROOM_FORM = { name: '', category: 'DOUBLE', capacity: '2', supplierCost: '', sellingPrice: '', totalRooms: '1' };

export default function AdminHotelCatalogPage() {
  const [hotels, setHotels] = useState<Hotel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hotelForm, setHotelForm] = useState(EMPTY_HOTEL_FORM);
  const [savingHotel, setSavingHotel] = useState(false);
  const [roomForms, setRoomForms] = useState<Record<string, typeof EMPTY_ROOM_FORM>>({});
  const [expandedHotel, setExpandedHotel] = useState<string | null>(null);

  function load() {
    apiRequest<Hotel[]>('/hotels/catalog')
      .then(setHotels)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, []);

  async function handleCreateHotel() {
    setError(null);
    if (!hotelForm.name.trim() || !hotelForm.city.trim() || !hotelForm.country.trim()) {
      setError('Name, city, and country are required.');
      return;
    }
    setSavingHotel(true);
    try {
      await apiRequest('/hotels/catalog', {
        method: 'POST',
        body: {
          name: hotelForm.name,
          city: hotelForm.city,
          country: hotelForm.country,
          starRating: Number(hotelForm.starRating),
        },
      });
      setHotelForm(EMPTY_HOTEL_FORM);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create hotel');
    } finally {
      setSavingHotel(false);
    }
  }

  async function toggleStatus(hotel: Hotel) {
    try {
      await apiRequest(`/hotels/catalog/${hotel.id}`, {
        method: 'PATCH',
        body: { status: hotel.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update hotel');
    }
  }

  async function addRoomType(hotelId: string) {
    const form = roomForms[hotelId] ?? EMPTY_ROOM_FORM;
    if (!form.name.trim() || !form.supplierCost || !form.sellingPrice) {
      setError('Room name, supplier cost, and selling price are required.');
      return;
    }
    try {
      await apiRequest(`/hotels/catalog/${hotelId}/room-types`, {
        method: 'POST',
        body: {
          name: form.name,
          category: form.category,
          capacity: Number(form.capacity),
          supplierCost: Number(form.supplierCost),
          sellingPrice: Number(form.sellingPrice),
          totalRooms: Number(form.totalRooms),
        },
      });
      setRoomForms((prev) => ({ ...prev, [hotelId]: EMPTY_ROOM_FORM }));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add room type');
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER']}>
      <AppShell title="Hotel Catalog" navLinks={ADMIN_NAV}>
        <p className="text-sm text-slate-500">
          Hotels and room types you manage directly — searchable and bookable alongside external providers, with
          margin (selling price − supplier cost) calculated automatically and never hard-coded.
        </p>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 max-w-3xl rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">New hotel</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input placeholder="Name" value={hotelForm.name} onChange={(e) => setHotelForm({ ...hotelForm, name: e.target.value })} className="col-span-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm sm:col-span-1" />
            <input placeholder="City" value={hotelForm.city} onChange={(e) => setHotelForm({ ...hotelForm, city: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input placeholder="Country" value={hotelForm.country} onChange={(e) => setHotelForm({ ...hotelForm, country: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <select value={hotelForm.starRating} onChange={(e) => setHotelForm({ ...hotelForm, starRating: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>{n} star</option>
              ))}
            </select>
          </div>
          <button onClick={handleCreateHotel} disabled={savingHotel} className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            {savingHotel ? 'Saving…' : 'Add hotel'}
          </button>
        </div>

        <div className="mt-6 space-y-4">
          {hotels?.map((hotel) => (
            <div key={hotel.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {hotel.name} <span className="font-normal text-slate-500">— {hotel.city}, {hotel.country} · {hotel.starRating}★</span>
                  </h3>
                  <p className="text-xs text-slate-500">{hotel.roomTypes.length} room type(s)</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => toggleStatus(hotel)} className={`rounded-full px-2 py-0.5 text-xs font-medium ${hotel.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                    {hotel.status}
                  </button>
                  <button onClick={() => setExpandedHotel(expandedHotel === hotel.id ? null : hotel.id)} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    {expandedHotel === hotel.id ? 'Hide' : 'Room Types'}
                  </button>
                </div>
              </div>

              {expandedHotel === hotel.id && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead>
                      <tr>
                        <th className="px-2 py-1 text-left font-medium text-slate-600">Room</th>
                        <th className="px-2 py-1 text-right font-medium text-slate-600">Supplier Cost</th>
                        <th className="px-2 py-1 text-right font-medium text-slate-600">Selling Price</th>
                        <th className="px-2 py-1 text-right font-medium text-slate-600">Margin</th>
                        <th className="px-2 py-1 text-right font-medium text-slate-600">Rooms</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {hotel.roomTypes.map((rt) => (
                        <tr key={rt.id}>
                          <td className="px-2 py-1 text-slate-800">{rt.name} <span className="text-slate-500">({rt.category})</span></td>
                          <td className="px-2 py-1 text-right text-slate-600">{formatCurrency(rt.supplierCost, rt.currency)}/night</td>
                          <td className="px-2 py-1 text-right text-slate-600">{formatCurrency(rt.sellingPrice, rt.currency)}/night</td>
                          <td className="px-2 py-1 text-right font-medium text-emerald-700">{formatCurrency(rt.sellingPrice - rt.supplierCost, rt.currency)}</td>
                          <td className="px-2 py-1 text-right text-slate-600">{rt.totalRooms}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
                    <input placeholder="Room name" value={roomForms[hotel.id]?.name ?? ''} onChange={(e) => setRoomForms((p) => ({ ...p, [hotel.id]: { ...(p[hotel.id] ?? EMPTY_ROOM_FORM), name: e.target.value } }))} className="col-span-2 rounded-md border border-slate-300 px-2 py-1 text-xs sm:col-span-1" />
                    <select value={roomForms[hotel.id]?.category ?? 'DOUBLE'} onChange={(e) => setRoomForms((p) => ({ ...p, [hotel.id]: { ...(p[hotel.id] ?? EMPTY_ROOM_FORM), category: e.target.value } }))} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
                      {['SINGLE', 'DOUBLE', 'TWIN', 'TRIPLE', 'QUAD', 'SUITE', 'FAMILY', 'VIP'].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input placeholder="Capacity" type="number" value={roomForms[hotel.id]?.capacity ?? '2'} onChange={(e) => setRoomForms((p) => ({ ...p, [hotel.id]: { ...(p[hotel.id] ?? EMPTY_ROOM_FORM), capacity: e.target.value } }))} className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                    <input placeholder="Supplier cost/night" type="number" value={roomForms[hotel.id]?.supplierCost ?? ''} onChange={(e) => setRoomForms((p) => ({ ...p, [hotel.id]: { ...(p[hotel.id] ?? EMPTY_ROOM_FORM), supplierCost: e.target.value } }))} className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                    <input placeholder="Selling price/night" type="number" value={roomForms[hotel.id]?.sellingPrice ?? ''} onChange={(e) => setRoomForms((p) => ({ ...p, [hotel.id]: { ...(p[hotel.id] ?? EMPTY_ROOM_FORM), sellingPrice: e.target.value } }))} className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                    <input placeholder="Total rooms" type="number" value={roomForms[hotel.id]?.totalRooms ?? '1'} onChange={(e) => setRoomForms((p) => ({ ...p, [hotel.id]: { ...(p[hotel.id] ?? EMPTY_ROOM_FORM), totalRooms: e.target.value } }))} className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                  </div>
                  <button onClick={() => addRoomType(hotel.id)} className="mt-2 rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    + Add room type
                  </button>
                </div>
              )}
            </div>
          ))}
          {hotels?.length === 0 && <p className="text-sm text-slate-500">No hotels in the catalog yet.</p>}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
