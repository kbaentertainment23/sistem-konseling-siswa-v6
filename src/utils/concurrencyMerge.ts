export const ADVISORY_LOCK_TTL_MS = 90_000;

export interface ConcurrencyMeta {
  _version?: number;
  updatedAt?: string;
  updatedBy?: string;
  lockBy?: string | null;
  lockByName?: string | null;
  lockExpiresAt?: number | null;
}

/**
 * Returns only the fields that changed between `base` and `next`
 * (or all non-undefined fields in `patch` when `base` is unavailable).
 */
export function diffChangedFields<T extends object>(
  base: Partial<T> | null | undefined,
  next: Partial<T>
): Partial<T> {
  if (!base) {
    const clean: Partial<T> = {};
    for (const [key, val] of Object.entries(next)) {
      if (val !== undefined) {
        (clean as Record<string, unknown>)[key] = val;
      }
    }
    return clean;
  }

  const changed: Partial<T> = {};
  for (const [key, val] of Object.entries(next)) {
    if (val === undefined) continue;
    if (key === '_version' || key === 'updatedAt' || key === 'updatedBy') continue;
    if (!Object.is(base[key as keyof T], val)) {
      (changed as Record<string, unknown>)[key] = val;
    }
  }
  return changed;
}

/**
 * Performs a 3-way field-level merge inside a Firestore Transaction.
 * Any field modified concurrently on `server` by another teacher is preserved
 * unless the current teacher explicitly changed that exact field relative to `base`.
 */
export function mergeRecordWithBase<T extends object & ConcurrencyMeta>(params: {
  base?: Partial<T> | null;
  server?: Partial<T> | null;
  patch: Partial<T>;
  actorName: string;
  nowISO?: string;
}): T & ConcurrencyMeta {
  const { base, server, patch, actorName, nowISO = new Date().toISOString() } = params;
  const changed = diffChangedFields(base, patch);
  const baseObj = (base || {}) as Partial<T>;
  const serverObj = (server || {}) as Partial<T>;
  const serverVersion = Math.max(0, Number(serverObj._version) || 0);

  const merged: Record<string, unknown> = {
    ...baseObj,
    ...serverObj,
    ...changed,
    _version: serverVersion + 1,
    updatedAt: nowISO,
    updatedBy: actorName,
    lockBy: null,
    lockByName: null,
    lockExpiresAt: null,
  };

  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) {
      delete merged[key];
    }
  }

  return merged as T & ConcurrencyMeta;
}

export interface LockCheckResult {
  lockedByOther: boolean;
  lockOwnerName: string;
  expiresAt: number;
}

export function checkAdvisoryLock(
  record: ConcurrencyMeta | null | undefined,
  currentActorId: string,
  nowMs = Date.now()
): LockCheckResult {
  if (!record || !record.lockBy || !record.lockExpiresAt) {
    return { lockedByOther: false, lockOwnerName: '', expiresAt: 0 };
  }
  if (record.lockBy === currentActorId) {
    return { lockedByOther: false, lockOwnerName: '', expiresAt: record.lockExpiresAt };
  }
  if (record.lockExpiresAt <= nowMs) {
    return { lockedByOther: false, lockOwnerName: '', expiresAt: 0 };
  }
  return {
    lockedByOther: true,
    lockOwnerName: record.lockByName || 'Guru BK lain',
    expiresAt: record.lockExpiresAt,
  };
}

export interface PendingOverlayOp<T extends { id: string }> {
  opId: string;
  docId: string;
  action: 'create' | 'update' | 'delete';
  data?: Partial<T>;
}

/**
 * Reconciles incoming Firestore `onSnapshot` docs with local queued/optimistic ops
 * so newly created or edited items never flicker or disappear before queue commit.
 */
export function reconcileCollectionWithPending<T extends { id: string }>(
  serverDocs: T[],
  pendingOps: Array<PendingOverlayOp<T>>
): T[] {
  if (pendingOps.length === 0) return serverDocs;

  const map = new Map<string, T>();
  for (const doc of serverDocs) {
    map.set(doc.id, doc);
  }

  for (const op of pendingOps) {
    if (op.action === 'delete') {
      map.delete(op.docId);
    } else if (op.action === 'create' && op.data) {
      const existing = map.get(op.docId);
      if (existing) {
        map.set(op.docId, { ...existing, ...op.data, id: op.docId });
      } else {
        map.set(op.docId, { ...(op.data as T), id: op.docId });
      }
    } else if (op.action === 'update' && op.data) {
      const existing = map.get(op.docId);
      if (existing) {
        map.set(op.docId, { ...existing, ...op.data, id: op.docId });
      }
    }
  }

  return Array.from(map.values());
}
