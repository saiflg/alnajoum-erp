/**
 * Controlled offline caching for Hajj/Umrah field operations (Phase 8
 * design §14). Deliberately narrow: only the allow-listed fields below are
 * ever written to IndexedDB, and only two things are cached — a read-only
 * projection of a group's roster for viewing when offline, and an outbox of
 * check-in scans performed offline, replayed once connectivity returns.
 *
 * Never cached, under any circumstance: passport numbers, financial figures
 * (outstanding balance, revenue, profitability), driver license numbers,
 * emergency-contact details, override reason text, or any auth token — the
 * browser's own httpOnly cookie is never duplicated here.
 *
 * Namespaced per signed-in identity id so one device's cache can't leak
 * between two staff accounts that share it; `clearOfflineCache` is called
 * from the logout flow in addition to the normal cookie invalidation.
 */

const DB_NAME = 'hajj-ops-offline-cache';
const DB_VERSION = 1;
const PROJECTION_STORE = 'group-projections';
const OUTBOX_STORE = 'checkin-outbox';

/** Cached projection stays usable for this long before a read requires the network again. */
export const PROJECTION_TTL_MS = 24 * 60 * 60 * 1000;

export type PilgrimType = 'HAJJ' | 'UMRAH';
export type ReadinessStatus = 'GREEN' | 'AMBER' | 'RED';

export interface CachedPilgrim {
  id: string;
  firstName: string;
  lastName: string;
  pilgrimCode: string | null;
  roomNumber: string | null;
  readinessStatus: ReadinessStatus | null;
}

export interface CachedGroupProjection {
  key: string; // `${identityId}:${type}:${groupId}`
  identityId: string;
  type: PilgrimType;
  groupId: string;
  groupNumber: string;
  name: string;
  status: string;
  departureDate: string | null;
  pilgrims: CachedPilgrim[];
  cachedAt: number;
}

export interface QueuedCheckIn {
  localId: string;
  identityId: string;
  pilgrimCode: string;
  event: string;
  location?: string;
  clientTimestamp: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTION_STORE)) {
        db.createObjectStore(PROJECTION_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'localId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Every IndexedDB call is wrapped: private browsing, blocked storage, or an unsupported browser must never break the page — offline caching is a nicety, not a dependency. */
async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

function projectionKey(identityId: string, type: PilgrimType, groupId: string): string {
  return `${identityId}:${type}:${groupId}`;
}

export async function cacheGroupProjection(
  projection: Omit<CachedGroupProjection, 'key' | 'cachedAt'>,
): Promise<void> {
  const record: CachedGroupProjection = {
    ...projection,
    key: projectionKey(projection.identityId, projection.type, projection.groupId),
    cachedAt: Date.now(),
  };
  await withStore(PROJECTION_STORE, 'readwrite', (store) => store.put(record));
}

/** Returns null if there is no cache, or it has expired past PROJECTION_TTL_MS — callers should treat either case as "no offline data available", not as an empty roster. */
export async function getCachedGroupProjection(
  identityId: string,
  type: PilgrimType,
  groupId: string,
): Promise<CachedGroupProjection | null> {
  const record = await withStore<CachedGroupProjection>(PROJECTION_STORE, 'readonly', (store) =>
    store.get(projectionKey(identityId, type, groupId)),
  );
  if (!record) return null;
  if (Date.now() - record.cachedAt > PROJECTION_TTL_MS) return null;
  return record;
}

export async function queueCheckIn(entry: Omit<QueuedCheckIn, 'localId'>): Promise<QueuedCheckIn> {
  const queued: QueuedCheckIn = {
    ...entry,
    localId: `${entry.identityId}-${entry.clientTimestamp}-${Math.random().toString(36).slice(2, 8)}`,
  };
  await withStore(OUTBOX_STORE, 'readwrite', (store) => store.put(queued));
  return queued;
}

export async function listQueuedCheckIns(identityId: string): Promise<QueuedCheckIn[]> {
  const all = (await withStore<QueuedCheckIn[]>(OUTBOX_STORE, 'readonly', (store) => store.getAll())) ?? [];
  return all.filter((entry) => entry.identityId === identityId);
}

export async function removeQueuedCheckIn(localId: string): Promise<void> {
  await withStore(OUTBOX_STORE, 'readwrite', (store) => store.delete(localId));
}

/** Called on logout, in addition to the normal cookie invalidation — a signed-out device keeps no cached roster or pending check-ins for that identity. */
export async function clearOfflineCache(identityId: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([PROJECTION_STORE, OUTBOX_STORE], 'readwrite');
    const projections = tx.objectStore(PROJECTION_STORE);
    const outbox = tx.objectStore(OUTBOX_STORE);

    await new Promise<void>((resolve) => {
      const req = projections.getAllKeys();
      req.onsuccess = () => {
        for (const key of req.result) {
          if (typeof key === 'string' && key.startsWith(`${identityId}:`)) projections.delete(key);
        }
        resolve();
      };
      req.onerror = () => resolve();
    });

    await new Promise<void>((resolve) => {
      const req = outbox.getAll();
      req.onsuccess = () => {
        for (const entry of req.result as QueuedCheckIn[]) {
          if (entry.identityId === identityId) outbox.delete(entry.localId);
        }
        resolve();
      };
      req.onerror = () => resolve();
    });
  } catch {
    // Best-effort — an unsupported/blocked IndexedDB is not a logout failure.
  }
}
