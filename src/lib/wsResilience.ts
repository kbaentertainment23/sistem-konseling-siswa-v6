export interface ReconnectOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  maxRetries?: number;
  onOpen?: (ws: WebSocket) => void;
  onMessage?: (event: MessageEvent) => void;
  onClose?: (event: CloseEvent, nextDelayMs: number | null) => void;
  onError?: (event: Event) => void;
}

/**
 * WebSocket wrapper with automatic exponential backoff reconnection
 * so dropped connections recover gracefully without crashing the app.
 */
export class ReconnectingWebSocket {
  private url: string;
  private protocols?: string | string[];
  private options: Required<Pick<ReconnectOptions, 'initialDelayMs' | 'maxDelayMs' | 'factor' | 'maxRetries'>> &
    Omit<ReconnectOptions, 'initialDelayMs' | 'maxDelayMs' | 'factor' | 'maxRetries'>;
  private ws: WebSocket | null = null;
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private manuallyClosed = false;

  constructor(url: string, protocols?: string | string[], options: ReconnectOptions = {}) {
    this.url = url;
    this.protocols = protocols;
    this.options = {
      initialDelayMs: options.initialDelayMs ?? 1000,
      maxDelayMs: options.maxDelayMs ?? 30000,
      factor: options.factor ?? 2,
      maxRetries: options.maxRetries ?? Infinity,
      ...options,
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
    }
    this.connect();
  }

  private getNextDelay(): number {
    const base = Math.min(
      this.options.maxDelayMs,
      this.options.initialDelayMs * Math.pow(this.options.factor, this.attempt)
    );
    // Add up to 20% jitter to avoid thundering herd reconnects
    const jitter = Math.random() * base * 0.2;
    return Math.round(base + jitter);
  }

  private handleOnline = () => {
    if (!this.manuallyClosed && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
      this.attempt = 0;
      this.clearTimer();
      this.connect();
    }
  };

  private clearTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private connect() {
    if (this.manuallyClosed) return;

    try {
      this.ws = this.protocols ? new WebSocket(this.url, this.protocols) : new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.attempt = 0;
      if (this.ws) {
        this.options.onOpen?.(this.ws);
      }
    };

    this.ws.onmessage = (event) => {
      this.options.onMessage?.(event);
    };

    this.ws.onerror = (event) => {
      this.options.onError?.(event);
    };

    this.ws.onclose = (event) => {
      const nextDelay = this.scheduleReconnect();
      this.options.onClose?.(event, nextDelay);
    };
  }

  private scheduleReconnect(): number | null {
    if (this.manuallyClosed || this.attempt >= this.options.maxRetries) {
      return null;
    }
    this.clearTimer();
    const delay = this.getNextDelay();
    this.attempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
    }, delay);
    return delay;
  }

  public send(data: string | Blob | BufferSource): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
      return true;
    }
    return false;
  }

  public close() {
    this.manuallyClosed = true;
    this.clearTimer();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
    }
    this.ws?.close();
    this.ws = null;
  }
}

let installed = false;

/**
 * Installs a global client-side guard for Vite HMR WebSocket disconnects
 * so transient WebSocket errors never trigger unhandled rejections or crash the UI,
 * and schedules a gentle exponential-backoff health check when disconnected in dev.
 */
export function initWebSocketResilience(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  let reconnectAttempt = 0;
  let retryTimer: number | null = null;

  const isViteWsError = (message: string): boolean => {
    const lower = message.toLowerCase();
    return (
      lower.includes('websocket closed without opened') ||
      lower.includes('failed to connect to websocket') ||
      (lower.includes('@vite/client') && lower.includes('websocket'))
    );
  };

  const scheduleDevPing = () => {
    if (retryTimer !== null || reconnectAttempt >= 6) return;
    const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempt));
    reconnectAttempt += 1;
    retryTimer = window.setTimeout(async () => {
      retryTimer = null;
      try {
        const res = await fetch('/api/drive-status', { cache: 'no-store' });
        if (res.ok) {
          reconnectAttempt = 0;
          return;
        }
      } catch {
        // Server still restarting — back off again
      }
      scheduleDevPing();
    }, delay);
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg =
      reason instanceof Error
        ? `${reason.message} ${reason.stack || ''}`
        : String(reason || '');
    if (isViteWsError(msg)) {
      event.preventDefault();
      scheduleDevPing();
    }
  });

  window.addEventListener('error', (event) => {
    const msg = `${event.message || ''} ${event.filename || ''}`;
    if (isViteWsError(msg)) {
      event.preventDefault();
      scheduleDevPing();
    }
  });
}
