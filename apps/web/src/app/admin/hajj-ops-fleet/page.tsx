'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import type { Driver, HajjOpsGroup, Transport, Vehicle } from '@/lib/hajj-ops-types';

const VEHICLE_TYPES: Vehicle['type'][] = ['BUS', 'VAN', 'SEDAN', 'SUV', 'OTHER'];
const TRANSPORT_TYPES: Transport['type'][] = [
  'AIRPORT_TRANSFER',
  'MAKKAH_TRANSPORT',
  'MADINAH_TRANSPORT',
  'INTERCITY',
  'GROUP_BUS',
  'PRIVATE_VEHICLE',
];

export default function HajjOpsFleetPage() {
  const { user } = useAuth();
  const canManageFleet = user?.permissions.includes('hajj_ops:fleet_manage') ?? false;
  const canManageTransport = user?.permissions.includes('hajj_ops:transport_manage') ?? false;
  const canViewSensitive = user?.permissions.includes('hajj_ops:driver_sensitive_view') ?? false;

  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [transports, setTransports] = useState<Transport[] | null>(null);
  const [hajjGroups, setHajjGroups] = useState<HajjOpsGroup[]>([]);
  const [umrahGroups, setUmrahGroups] = useState<HajjOpsGroup[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [plateNumber, setPlateNumber] = useState('');
  const [vehicleType, setVehicleType] = useState<Vehicle['type']>('BUS');
  const [capacity, setCapacity] = useState('14');

  const [driverFirstName, setDriverFirstName] = useState('');
  const [driverLastName, setDriverLastName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [driverLicense, setDriverLicense] = useState('');
  const [driverVehicleId, setDriverVehicleId] = useState('');

  const [transportType, setTransportType] = useState<Transport['type']>('AIRPORT_TRANSFER');
  const [transportGroupKey, setTransportGroupKey] = useState(''); // "HAJJ:id" or "UMRAH:id"
  const [transportVehicleId, setTransportVehicleId] = useState('');
  const [transportDriverId, setTransportDriverId] = useState('');
  const [pickupLocation, setPickupLocation] = useState('');
  const [dropoffLocation, setDropoffLocation] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');

  function load() {
    apiRequest<Vehicle[]>('/hajj-ops/fleet/vehicles').then(setVehicles).catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load vehicles'));
    apiRequest<Driver[]>('/hajj-ops/fleet/drivers').then(setDrivers).catch(() => undefined);
    apiRequest<Transport[]>('/hajj-ops/transport').then(setTransports).catch(() => undefined);
    apiRequest<HajjOpsGroup[]>('/hajj-ops/hajj-groups').then(setHajjGroups).catch(() => undefined);
    apiRequest<HajjOpsGroup[]>('/hajj-ops/umrah-groups').then(setUmrahGroups).catch(() => undefined);
  }

  useEffect(load, []);

  async function createVehicle(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/hajj-ops/fleet/vehicles', {
        method: 'POST',
        body: { plateNumber, type: vehicleType, capacity: Number(capacity) },
      });
      setPlateNumber('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create vehicle');
    }
  }

  async function createDriver(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/hajj-ops/fleet/drivers', {
        method: 'POST',
        body: {
          firstName: driverFirstName,
          lastName: driverLastName,
          phone: driverPhone,
          licenseNumber: driverLicense || undefined,
          vehicleId: driverVehicleId || undefined,
        },
      });
      setDriverFirstName('');
      setDriverLastName('');
      setDriverPhone('');
      setDriverLicense('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create driver');
    }
  }

  async function createTransport(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const [kind, groupId] = transportGroupKey.split(':');
    if (!kind || !groupId) {
      setError('Select a group for this transport assignment.');
      return;
    }
    try {
      await apiRequest('/hajj-ops/transport', {
        method: 'POST',
        body: {
          type: transportType,
          hajjGroupId: kind === 'HAJJ' ? groupId : undefined,
          umrahGroupId: kind === 'UMRAH' ? groupId : undefined,
          vehicleId: transportVehicleId || undefined,
          driverId: transportDriverId || undefined,
          pickupLocation,
          dropoffLocation,
          scheduledAt: new Date(scheduledAt).toISOString(),
        },
      });
      setPickupLocation('');
      setDropoffLocation('');
      setScheduledAt('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to schedule transport');
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF']}>
      <AppShell title="Fleet & Transport" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Fleet &amp; Transport</h2>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <h3 className="mt-4 text-sm font-semibold text-slate-700">Vehicles</h3>
        {canManageFleet && (
          <form onSubmit={createVehicle} className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-4">
            <input value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} placeholder="Plate number" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value as Vehicle['type'])} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {VEHICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Capacity" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
              Add vehicle
            </button>
          </form>
        )}
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Plate</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Type</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Capacity</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vehicles?.map((v) => (
                <tr key={v.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">{v.plateNumber}</td>
                  <td className="px-3 py-2 text-slate-600">{v.type}</td>
                  <td className="px-3 py-2 text-slate-600">{v.capacity}</td>
                  <td className="px-3 py-2 text-slate-600">{v.status}</td>
                </tr>
              ))}
              {vehicles?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                    No vehicles yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h3 className="mt-6 text-sm font-semibold text-slate-700">Drivers</h3>
        {canManageFleet && (
          <form onSubmit={createDriver} className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-5">
            <input value={driverFirstName} onChange={(e) => setDriverFirstName(e.target.value)} placeholder="First name" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input value={driverLastName} onChange={(e) => setDriverLastName(e.target.value)} placeholder="Last name" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} placeholder="Phone" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input value={driverLicense} onChange={(e) => setDriverLicense(e.target.value)} placeholder="License number" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <select value={driverVehicleId} onChange={(e) => setDriverVehicleId(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">— No vehicle —</option>
              {vehicles?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNumber}
                </option>
              ))}
            </select>
            <div className="col-span-2 sm:col-span-5">
              <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
                Add driver
              </button>
            </div>
          </form>
        )}
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Phone</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Vehicle</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                {canViewSensitive && <th className="px-3 py-2 text-left font-medium text-slate-600">License</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {drivers?.map((d) => (
                <tr key={d.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {d.firstName} {d.lastName}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{d.phone}</td>
                  <td className="px-3 py-2 text-slate-600">{d.vehicle?.plateNumber ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{d.status}</td>
                  {canViewSensitive && <td className="px-3 py-2 text-slate-400">Restricted — open driver record to view</td>}
                </tr>
              ))}
              {drivers?.length === 0 && (
                <tr>
                  <td colSpan={canViewSensitive ? 5 : 4} className="px-3 py-4 text-center text-slate-500">
                    No drivers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h3 className="mt-6 text-sm font-semibold text-slate-700">Transport Schedule</h3>
        {canManageTransport && (
          <form onSubmit={createTransport} className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-4">
            <select value={transportType} onChange={(e) => setTransportType(e.target.value as Transport['type'])} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {TRANSPORT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <select value={transportGroupKey} onChange={(e) => setTransportGroupKey(e.target.value)} required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">— Select group —</option>
              {hajjGroups.map((g) => (
                <option key={`HAJJ:${g.id}`} value={`HAJJ:${g.id}`}>
                  Hajj: {g.groupNumber}
                </option>
              ))}
              {umrahGroups.map((g) => (
                <option key={`UMRAH:${g.id}`} value={`UMRAH:${g.id}`}>
                  Umrah: {g.groupNumber}
                </option>
              ))}
            </select>
            <select value={transportVehicleId} onChange={(e) => setTransportVehicleId(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">— No vehicle —</option>
              {vehicles?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNumber}
                </option>
              ))}
            </select>
            <select value={transportDriverId} onChange={(e) => setTransportDriverId(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">— No driver —</option>
              {drivers?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.firstName} {d.lastName}
                </option>
              ))}
            </select>
            <input value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value)} placeholder="Pickup location" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input value={dropoffLocation} onChange={(e) => setDropoffLocation(e.target.value)} placeholder="Dropoff location" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
              Schedule transport
            </button>
          </form>
        )}
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Type</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Route</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Scheduled</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Vehicle / Driver</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transports?.map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2 text-slate-700">{t.type.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {t.pickupLocation} → {t.dropoffLocation}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{formatDateTime(t.scheduledAt)}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {t.vehicle?.plateNumber ?? '—'} {t.driver ? `/ ${t.driver.firstName} ${t.driver.lastName}` : ''}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{t.status}</td>
                </tr>
              ))}
              {transports?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                    No transport scheduled yet.
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
