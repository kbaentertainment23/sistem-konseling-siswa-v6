export type SyncEntity = 'cases' | 'counselingLogs' | 'parentCalls';
export type SyncAction = 'create' | 'update' | 'delete';

export interface QueuedSyncItem<TPayload = unknown> {
  opId: string;
  entity: SyncEntity;
  action: SyncAction;
  docId: string;
  payload: TPayload;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface SyncQueueSnapshot {
  pendingCount: number;
  processing: boolean;
  lastError: string | null;
  pendingByEntity: Record<SyncEntity, QueuedSyncItem[]>;
}

const STORAGE_KEY = 'sibk_sync_queue_v1';
const MAX_RETRY_ATTEMPTS = 5;

export function isTransientNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('unavailable') ||
    msg.includes('network') ||
    msg.includes('failed to get document') ||
    msg.includes('client is offline') ||
    msg.includes('deadline-exceeded') ||
    msg.includes('aborted') ||
    msg.includes('resource-exhausted') ||
    msg.includes('timeout')
  );
}

export type SyncExecutor = (item: QueuedSyncItem) => Promise<void>;

export class PersistentSyncQueue {
  private items: QueuedSyncItem[] = [];
  private processing = false;
  private lastError: string | null = null;
  private executor: SyncExecutor | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(snap: SyncQueueSnapshot) => void>();
  private waitResolvers = new Map<
    string,
    { resolve: () => void; reject: (err: unknown) => void }
  >();
  private rollbackCallbacks = new Map<string, () => void>();

  constructor() {
    this.loadFromStorage();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        void this.drain();
      });
    }
  }

  private loadFromStorage() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.items = parsed.filter(
          (i): i is QueuedSyncItem =>
            Boolean(i && typeof i === 'object' && i.opId && i.entity && i.action && i.docId)
        );
      }
    } catch {
      this.items = [];
    }
  }

  private saveToStorage() {
    if (typeof localStorage === 'undefined') return;
    try {
      if (this.items.length === 0) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
      }
    } catch {
      // Ignore quota errors
    }
  }

  setExecutor(fn: SyncExecutor | null) {
    this.executor = fn;
    if (fn && this.items.length > 0) {
      void this.drain();
    }
  }

  getSnapshot(): SyncQueueSnapshot {
    const pendingByEntity: Record<SyncEntity, QueuedSyncItem[]> = {
      cases: [],
      counselingLogs: [],
      parentCalls: [],
    };
    for (const item of this.items) {
      if (pendingByEntity[item.entity]) {
        pendingByEntity[item.entity].push(item);
      }
    }
    return {
      pendingCount: this.items.length,
      processing: this.processing,
      lastError: this.lastError,
      pendingByEntity,
    };
  }

  subscribe(listener: (snap: SyncQueueSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    const snap = this.getSnapshot();
    this.listeners.forEach((fn) => fn(snap));
  }

  clearError() {
    this.lastError = null;
    this.emit();
  }

  /**
   * Enqueues a write operation with optional optimistic rollback callback.
   * When offline, resolves cleanly so Optimistic UI stays responsive while the queue
   * waits for connectivity. When online, resolves on commit or rejects & rolls back
   * on permanent server/permission error.
   */
  enqueue<TPayload>(params: {
    entity: SyncEntity;
    action: SyncAction;
    docId: string;
    payload: TPayload;
    onRollback?: () => void;
  }): Promise<void> {
    const opId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const item: QueuedSyncItem<TPayload> = {
      opId,
      entity: params.entity,
      action: params.action,
      docId: params.docId,
      payload: params.payload,
      createdAt: Date.now(),
      attempts: 0,
    };

    if (params.onRollback) {
      this.rollbackCallbacks.set(opId, params.onRollback);
    }

    this.items.push(item);
    this.saveToStorage();
    this.emit();

    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (isOffline) {
      void this.drain();
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      this.waitResolvers.set(opId, { resolve, reject });
      void this.drain();
    });
  }

  async drain(): Promise<void> {
    if (this.processing || !this.executor || this.items.length === 0) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    this.processing = true;
    this.emit();

    try {
      while (this.items.length > 0) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          // Offline mid-drain: resolve waiters optimistically and hold remaining queue
          for (const item of this.items) {
            const waiter = this.waitResolvers.get(item.opId);
            if (waiter) {
              waiter.resolve();
              this.waitResolvers.delete(item.opId);
            }
          }
          break;
        }

        const current = this.items[0];
        try {
          await this.executor(current);
          this.items.shift();
          this.lastError = null;
          this.saveToStorage();
          this.rollbackCallbacks.delete(current.opId);
          const waiter = this.waitResolvers.get(current.opId);
          if (waiter) {
            waiter.resolve();
            this.waitResolvers.delete(current.opId);
          }
          this.emit();
        } catch (err) {
          current.attempts += 1;
          current.lastError = err instanceof Error ? err.message : String(err);

          if (isTransientNetworkError(err) && current.attempts < MAX_RETRY_ATTEMPTS) {
            this.saveToStorage();
            // Let optimistic caller finish cleanly while background retry runs
            const waiter = this.waitResolvers.get(current.opId);
            if (waiter) {
              waiter.resolve();
              this.waitResolvers.delete(current.opId);
            }
            const delayMs = Math.min(8000, 500 * Math.pow(2, current.attempts - 1));
            this.retryTimer = setTimeout(() => {
              void this.drain();
            }, delayMs);
            break;
          }

          // Permanent / unrecoverable error -> dequeue, rollback optimistic UI, notify caller
          this.items.shift();
          this.lastError = current.lastError;
          this.saveToStorage();
          const rollback = this.rollbackCallbacks.get(current.opId);
          this.rollbackCallbacks.delete(current.opId);
          if (rollback) {
            try {
              rollback();
            } catch {
              // Ignore rollback failure
            }
          }
          const waiter = this.waitResolvers.get(current.opId);
          if (waiter) {
            waiter.reject(err);
            this.waitResolvers.delete(current.opId);
          }
          this.emit();
        }
      }
    } finally {
      this.processing = false;
      this.emit();
    }
  }
}
