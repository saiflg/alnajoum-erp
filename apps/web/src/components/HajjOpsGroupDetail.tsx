'use client';

import { useEffect, useState } from 'react';
import { apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import type {
  GroupPilgrim,
  HajjOpsGroup,
  LinkableHotelBooking,
  PilgrimReadiness,
  ReadinessStatus,
  RoomAllocation,
  TravelGroupStatus,
} from '@/lib/hajj-ops-types';
import { cacheGroupProjection, getCachedGroupProjection, type CachedGroupProjection } from '@/lib/offline-cache';

const STATUSES: TravelGroupStatus[] = [
  'PLANNING',
  'REGISTRATION_OPEN',
  'ALMOST_FULL',
  'FULL',
  'DEPARTED',
  'IN_SAUDI_ARABIA',
  'RETURNING',
  'COMPLETED',
  'CANCELLED',
];

function ReadinessBadge({ status }: { status: ReadinessStatus }) {
  const cls =
    status === 'GREEN'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'AMBER'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-red-100 text-red-800';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

interface RegistrationPilgrimOption {
  id: string;
  firstName: string;
  lastName: string;
  groupId?: string | null;
  registration: { registrationNumber: string };
}

export function HajjOpsGroupDetail({ type, groupId }: { type: 'HAJJ' | 'UMRAH'; groupId: string }) {
  const { user } = useAuth();
  const perms = user?.permissions ?? [];
  const canManage = perms.includes('hajj_ops:group_manage');
  const canOverride = perms.includes('hajj_ops:checklist_override');
  const canCheckIn = perms.includes('hajj_ops:check_in');
  const canViewManifest = perms.includes('hajj_ops:manifest_view');

  const basePath = type === 'HAJJ' ? '/hajj-ops/hajj-groups' : '/hajj-ops/umrah-groups';

  const [group, setGroup] = useState<HajjOpsGroup | null>(null);
  const [readiness, setReadiness] = useState<Record<string, PilgrimReadiness>>({});
  const [rooms, setRooms] = useState<RoomAllocation[] | null>(null);
  const [linkableHotelBookings, setLinkableHotelBookings] = useState<LinkableHotelBooking[]>([]);
  const [candidatePilgrims, setCandidatePilgrims] = useState<RegistrationPilgrimOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offlineData, setOfflineData] = useState<CachedGroupProjection | null>(null);

  const [overridingId, setOverridingId] = useState<string | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<ReadinessStatus>('AMBER');
  const [overrideReason, setOverrideReason] = useState('');

  const [roomHotelName, setRoomHotelName] = useState('');
  const [roomHotelBookingId, setRoomHotelBookingId] = useState('');
  const [roomType, setRoomType] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [roomCapacity, setRoomCapacity] = useState('2');

  async function loadOfflineFallback() {
    if (!user) return;
    const cached = await getCachedGroupProjection(user.id, type, groupId);
    setOfflineData(cached);
    if (!cached) {
      setError('This group has not been viewed on this device before, so no offline copy is available.');
    }
  }

  function load() {
    setOfflineData(null);
    const roomParam = type === 'HAJJ' ? 'hajjGroupId' : 'umrahGroupId';

    Promise.all([
      apiRequest<HajjOpsGroup>(`${basePath}/${groupId}`),
      apiRequest<RoomAllocation[]>(`/hajj-ops/rooms?${roomParam}=${groupId}`),
    ])
      .then(async ([g, roomList]) => {
        setGroup(g);
        setRooms(roomList);

        const roomByPilgrim = new Map<string, string>();
        for (const room of roomList) {
          for (const occupant of room.occupants) roomByPilgrim.set(occupant.pilgrimId, room.roomNumber);
        }

        const readinessEntries = await Promise.all(
          g.pilgrims.map(async (p) => {
            try {
              const r = await apiRequest<PilgrimReadiness>(`/hajj-ops/readiness/${type}/${p.id}`);
              setReadiness((prev) => ({ ...prev, [p.id]: r }));
              return [p.id, r] as const;
            } catch {
              return [p.id, null] as const;
            }
          }),
        );

        // Spec #14 — cache only the allow-listed, low-sensitivity projection
        // (never passport numbers, amounts, or override reason text) for
        // offline viewing later; this is a nicety, so a failure here (e.g.
        // IndexedDB unavailable) must never surface to the user.
        if (user) {
          const readinessMap = new Map(readinessEntries);
          cacheGroupProjection({
            identityId: user.id,
            type,
            groupId,
            groupNumber: g.groupNumber,
            name: g.name,
            status: g.status,
            departureDate: g.departureDate,
            pilgrims: g.pilgrims.map((p) => ({
              id: p.id,
              firstName: p.firstName,
              lastName: p.lastName,
              // Not fetched here — the group roster doesn't need every
              // pilgrim's QR code, and generating one is a mutation
              // (ensurePilgrimCode creates it on first read). The field
              // check-in page caches it separately, scoped to the pilgrim
              // actually being scanned.
              pilgrimCode: null,
              roomNumber: roomByPilgrim.get(p.id) ?? null,
              readinessStatus: readinessMap.get(p.id)?.finalStatus ?? null,
            })),
          }).catch(() => undefined);
        }
      })
      .catch((err) => {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          // Not an HTTP error — most likely offline/unreachable. Fall back
          // to whatever was cached from the last successful view instead of
          // just showing an error.
          loadOfflineFallback();
        }
      });
  }

  // Same "check auth/load on mount" idiom as AuthProvider's own effect
  // (see its comment) — `load` resets offline-fallback state synchronously
  // before re-fetching, and calls `loadOfflineFallback` on a genuine
  // network failure; both are intentional, not derived-state anti-patterns.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(load, [groupId, type, basePath, user]);

  useEffect(() => {
    if (!group?.packageId) return;
    const path = type === 'HAJJ' ? '/hajj/registrations' : '/umrah/registrations';
    interface RegistrationWithPilgrims {
      registrationNumber: string;
      pilgrims: Array<Omit<RegistrationPilgrimOption, 'registration'>>;
    }
    apiRequest<RegistrationWithPilgrims[]>(`${path}?packageId=${group.packageId}`)
      .then((regs) => {
        const all = regs.flatMap((r) =>
          r.pilgrims.map((p) => ({ ...p, registration: { registrationNumber: r.registrationNumber } })),
        );
        setCandidatePilgrims(all.filter((p) => p.groupId !== groupId));
      })
      .catch(() => undefined);
  }, [group?.packageId, type, groupId]);

  useEffect(() => {
    apiRequest<LinkableHotelBooking[]>(`/hajj-ops/rooms/hotel-bookings?type=${type}&groupId=${groupId}`)
      .then(setLinkableHotelBookings)
      .catch(() => undefined);
  }, [type, groupId]);

  async function changeStatus(status: TravelGroupStatus) {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`${basePath}/${groupId}/status`, { method: 'PATCH', body: { status } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status');
    } finally {
      setBusy(false);
    }
  }

  async function assignPilgrim(pilgrimId: string) {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`${basePath}/${groupId}/pilgrims`, { method: 'POST', body: { pilgrimId } });
      setNotice('Pilgrim assigned to group.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to assign pilgrim');
    } finally {
      setBusy(false);
    }
  }

  async function removePilgrim(pilgrimId: string) {
    if (!confirm('Remove this pilgrim from the group?')) return;
    setBusy(true);
    try {
      await apiRequest(`${basePath}/${groupId}/pilgrims/${pilgrimId}/remove`, { method: 'PATCH' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove pilgrim');
    } finally {
      setBusy(false);
    }
  }

  async function submitOverride(pilgrimId: string) {
    if (overrideReason.trim().length < 5) {
      setError('Please give a reason of at least 5 characters for the override.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/hajj-ops/readiness/${type}/${pilgrimId}/override`, {
        method: 'POST',
        body: { status: overrideStatus, reason: overrideReason },
      });
      setOverridingId(null);
      setOverrideReason('');
      const r = await apiRequest<PilgrimReadiness>(`/hajj-ops/readiness/${type}/${pilgrimId}`);
      setReadiness((prev) => ({ ...prev, [pilgrimId]: r }));
      setNotice('Readiness status overridden.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to override readiness');
    } finally {
      setBusy(false);
    }
  }

  async function checkIn(pilgrimId: string) {
    setBusy(true);
    try {
      await apiRequest(`/hajj-ops/checkin/${type}/${pilgrimId}`, {
        method: 'POST',
        body: { event: 'GROUP_CHECK_IN' },
      });
      setNotice('Pilgrim checked in.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to check in pilgrim');
    } finally {
      setBusy(false);
    }
  }

  async function createRoom() {
    // A hotelName is only required when NOT linking a real booking — the
    // backend snapshots hotelName from the booking in that case.
    if ((!roomHotelName && !roomHotelBookingId) || !roomNumber) return;
    setBusy(true);
    setError(null);
    try {
      const key = type === 'HAJJ' ? 'hajjGroupId' : 'umrahGroupId';
      await apiRequest('/hajj-ops/rooms', {
        method: 'POST',
        body: {
          [key]: groupId,
          hotelName: roomHotelBookingId ? undefined : roomHotelName,
          hotelBookingId: roomHotelBookingId || undefined,
          roomType: roomType || undefined,
          roomNumber,
          capacity: Number(roomCapacity) || 2,
        },
      });
      setRoomHotelName('');
      setRoomHotelBookingId('');
      setRoomType('');
      setRoomNumber('');
      setRoomCapacity('2');
      const roomParam = type === 'HAJJ' ? 'hajjGroupId' : 'umrahGroupId';
      apiRequest<RoomAllocation[]>(`/hajj-ops/rooms?${roomParam}=${groupId}`).then(setRooms);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create room');
    } finally {
      setBusy(false);
    }
  }

  async function assignOccupant(roomId: string, pilgrim: GroupPilgrim) {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/hajj-ops/rooms/${roomId}/occupants`, {
        method: 'POST',
        body: { pilgrimType: type, pilgrimId: pilgrim.id },
      });
      const roomParam = type === 'HAJJ' ? 'hajjGroupId' : 'umrahGroupId';
      apiRequest<RoomAllocation[]>(`/hajj-ops/rooms?${roomParam}=${groupId}`).then(setRooms);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to assign to room');
    } finally {
      setBusy(false);
    }
  }

  if (!group) {
    if (offlineData) {
      return (
        <div>
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <strong>Offline</strong> — showing a cached copy of this roster from{' '}
            {new Date(offlineData.cachedAt).toLocaleString()}. Reconnect to manage the group, override
            readiness, or check pilgrims in.
          </div>
          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-lg font-semibold text-slate-900">
              {offlineData.name} <span className="ml-2 text-xs font-normal text-slate-500">{offlineData.groupNumber}</span>
            </p>
            <p className="text-sm text-slate-500">
              {offlineData.status.replace(/_/g, ' ')}
              {offlineData.departureDate ? ` · Departs ${formatDateTime(offlineData.departureDate)}` : ''}
            </p>
          </div>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Room</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Readiness</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {offlineData.pilgrims.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {p.firstName} {p.lastName}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{p.roomNumber ?? 'Unassigned'}</td>
                    <td className="px-3 py-2">
                      {p.readinessStatus ? <ReadinessBadge status={p.readinessStatus} /> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    return <p className="text-sm text-slate-500">{error ?? 'Loading…'}</p>;
  }

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

  return (
    <div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {notice && <p className="mt-2 text-sm text-emerald-600">{notice}</p>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <p className="text-lg font-semibold text-slate-900">
            {group.name} <span className="ml-2 text-xs font-normal text-slate-500">{group.groupNumber}</span>
          </p>
          <p className="text-sm text-slate-500">
            {group.package?.name ?? 'No package'} · {group.pilgrims.length} pilgrim
            {group.pilgrims.length === 1 ? '' : 's'}
            {group.maxCapacity ? ` of ${group.maxCapacity}` : ''} ·{' '}
            {group.coordinatorStaff
              ? `Coordinator: ${group.coordinatorStaff.firstName} ${group.coordinatorStaff.lastName}`
              : 'No coordinator'}
          </p>
          {group.departureDate && (
            <p className="text-sm text-slate-500">
              Departs {formatDateTime(group.departureDate)}
              {group.returnDate ? ` · Returns ${formatDateTime(group.returnDate)}` : ''}
              {group.airline ? ` · ${group.airline}` : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canManage ? (
            <select
              value={group.status}
              disabled={busy}
              onChange={(e) => changeStatus(e.target.value as TravelGroupStatus)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
              {group.status.replace(/_/g, ' ')}
            </span>
          )}
          {canViewManifest && (
            <>
              <a
                href={`${apiBase}/api/v1/hajj-ops/manifests/${type}/${groupId}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Manifest (PDF)
              </a>
              <a
                href={`${apiBase}/api/v1/hajj-ops/manifests/${type}/${groupId}/csv`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Manifest (CSV)
              </a>
            </>
          )}
        </div>
      </div>

      {canManage && candidatePilgrims.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-700">Assign a pilgrim to this group</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {candidatePilgrims.map((p) => (
              <button
                key={p.id}
                disabled={busy}
                onClick={() => assignPilgrim(p.id)}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                + {p.firstName} {p.lastName} ({p.registration.registrationNumber})
              </button>
            ))}
          </div>
        </div>
      )}

      <h3 className="mt-6 text-sm font-semibold text-slate-700">Pilgrims &amp; Readiness</h3>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Passport</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Readiness</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Missing / Notes</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {group.pilgrims.map((p) => {
              const r = readiness[p.id];
              return (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {p.firstName} {p.lastName}
                    {p.familyMember && <span className="ml-1 text-slate-400">(family)</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{p.passportNumber ?? '—'}</td>
                  <td className="px-3 py-2">
                    {r ? <ReadinessBadge status={r.finalStatus} /> : '…'}
                    {r?.override && (
                      <span className="ml-1 text-[10px] text-slate-400" title={r.override.reason}>
                        (overridden)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {r && !r.override && r.missingDocuments.length > 0 && `Missing: ${r.missingDocuments.join(', ')}`}
                    {r && !r.override && r.missingDocuments.length === 0 && r.outstandingAmount > 0 && 'Payment outstanding'}
                    {r?.override && r.override.reason}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {canCheckIn && (
                        <button disabled={busy} onClick={() => checkIn(p.id)} className="text-slate-600 hover:underline disabled:opacity-50">
                          Check in
                        </button>
                      )}
                      {canOverride && (
                        <button
                          disabled={busy}
                          onClick={() => setOverridingId(overridingId === p.id ? null : p.id)}
                          className="text-amber-600 hover:underline disabled:opacity-50"
                        >
                          Override
                        </button>
                      )}
                      {canManage && (
                        <button disabled={busy} onClick={() => removePilgrim(p.id)} className="text-red-600 hover:underline disabled:opacity-50">
                          Remove
                        </button>
                      )}
                    </div>
                    {overridingId === p.id && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-2">
                        <select
                          value={overrideStatus}
                          onChange={(e) => setOverrideStatus(e.target.value as ReadinessStatus)}
                          className="rounded-md border border-slate-300 px-1.5 py-1 text-xs"
                        >
                          <option value="GREEN">GREEN</option>
                          <option value="AMBER">AMBER</option>
                          <option value="RED">RED</option>
                        </select>
                        <input
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          placeholder="Reason (required)"
                          className="min-w-[200px] flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                        />
                        <button
                          disabled={busy}
                          onClick={() => submitOverride(p.id)}
                          className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                        >
                          Save
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {group.pilgrims.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                  No pilgrims assigned yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 className="mt-6 text-sm font-semibold text-slate-700">Room Allocation</h3>
      {canManage && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
          {linkableHotelBookings.length > 0 && (
            <label className="mb-2 block text-xs text-slate-500">
              Link to a real hotel booking (optional — overrides the hotel name below)
              <select
                value={roomHotelBookingId}
                onChange={(e) => setRoomHotelBookingId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
              >
                <option value="">— Free-text hotel name instead —</option>
                {linkableHotelBookings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bookingReference} — {b.hotelName}, {b.city} ({formatDateTime(b.checkInDate)} –{' '}
                    {formatDateTime(b.checkOutDate)})
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <input
              value={roomHotelBookingId ? linkableHotelBookings.find((b) => b.id === roomHotelBookingId)?.hotelName ?? '' : roomHotelName}
              onChange={(e) => setRoomHotelName(e.target.value)}
              disabled={!!roomHotelBookingId}
              placeholder="Hotel name"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs disabled:bg-slate-50 disabled:text-slate-400"
            />
            <input value={roomType} onChange={(e) => setRoomType(e.target.value)} placeholder="Room type (e.g. Quad)" className="rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
            <input value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="Room number" className="rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
            <input type="number" min={1} value={roomCapacity} onChange={(e) => setRoomCapacity(e.target.value)} placeholder="Capacity" className="rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
            <button disabled={busy} onClick={createRoom} className="rounded-md bg-slate-900 px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              Add room
            </button>
          </div>
        </div>
      )}
      <div className="mt-2 space-y-2">
        {rooms?.map((room) => (
          <div key={room.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-sm font-medium text-slate-800">
              {room.hotelName} — Room {room.roomNumber} {room.roomType ? `(${room.roomType})` : ''}{' '}
              <span className="text-xs font-normal text-slate-500">
                {room.occupants.length}/{room.capacity} occupied
              </span>
              {room.hotelBooking && (
                <span
                  className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800"
                  title={`${room.hotelBooking.city} · ${formatDateTime(room.hotelBooking.checkInDate)} – ${formatDateTime(room.hotelBooking.checkOutDate)}`}
                >
                  Linked: {room.hotelBooking.bookingReference}
                </span>
              )}
            </p>
            <ul className="mt-1 text-xs text-slate-600">
              {room.occupants.map((o) => {
                const pilgrim = group.pilgrims.find((p) => p.id === o.pilgrimId);
                return (
                  <li key={o.id}>
                    {pilgrim ? `${pilgrim.firstName} ${pilgrim.lastName}` : o.pilgrimId}
                    {o.checkedInAt ? ' · checked in' : ''}
                  </li>
                );
              })}
            </ul>
            {canManage && room.occupants.length < room.capacity && (
              <div className="mt-2 flex flex-wrap gap-1">
                {group.pilgrims
                  .filter((p) => !room.occupants.some((o) => o.pilgrimId === p.id))
                  .map((p) => (
                    <button
                      key={p.id}
                      disabled={busy}
                      onClick={() => assignOccupant(room.id, p)}
                      className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      + {p.firstName}
                    </button>
                  ))}
              </div>
            )}
          </div>
        ))}
        {rooms?.length === 0 && <p className="text-sm text-slate-500">No rooms allocated yet.</p>}
      </div>
    </div>
  );
}
