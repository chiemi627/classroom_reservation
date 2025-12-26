import fs from 'fs';
import path from 'path';
import os from 'os';
import ical from 'node-ical';

// Vercel KV removed — fallback to Neon/Redis or disk is used instead.
// If you later want optional KV support, reintroduce dynamic import with
// eval('require') or ensure @vercel/kv is added to package.json.

// --- Neon / Postgres support (dynamic, optional) ---
let pgClient: any = null;
// parse env bool reliably: accept 1/true/yes/on (case-insensitive)
function parseEnvBool(v?: string) {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(s);
}
const hasDbConn = Boolean(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL);
// enable Neon when explicit env true OR a DB connection string is present
const useNeon = parseEnvBool(process.env.USE_NEON) || hasDbConn;

async function ensureNeon() {
  if (pgClient || !useNeon) return;
  try {
    console.log('[calendarStore] ensureNeon start', { useNeon, hasDbConn: Boolean(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL) });
    // dynamic import so local dev without pg doesn't crash
    // @ts-ignore
    const { Client } = await import('pg');
    const conn = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!conn) throw new Error('Neon connection string not found (NEON_DATABASE_URL or DATABASE_URL)');
    const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
    await client.connect();
    pgClient = client;
    console.log('[calendarStore] connected to Neon (conn present)');
    // ensure table exists (idempotent)
    // create a history table to store versions of the cache (one row per update)
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS kv_store_history (
        id BIGSERIAL PRIMARY KEY,
        key TEXT NOT NULL,
        value JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await pgClient.query(`
      CREATE INDEX IF NOT EXISTS idx_kv_store_history_key_created_at ON kv_store_history(key, created_at DESC);
    `);
    console.log('[calendarStore] Neon (Postgres) initialized');
  } catch (e) {
    console.warn('[calendarStore] Neon not available:', e?.message || e);
    pgClient = null;
  }
}

async function pgGet(key: string) {
  await ensureNeon();
  if (!pgClient) return null;
  try {
    // fetch latest inserted history row for the key
    const r = await pgClient.query(
      'SELECT value FROM kv_store_history WHERE key = $1 ORDER BY created_at DESC LIMIT 1',
      [key]
    );
    if (r.rows.length === 0) return null;
    console.log('[calendarStore] pgGet HIT (history)', key);
    return r.rows[0].value;
  } catch (e) {
    console.error('[calendarStore] pgGet failed:', (e as any)?.message || e, (e as any)?.stack || '');
    return null;
  }
}

async function pgSet(key: string, value: string): Promise<boolean> {
  await ensureNeon();
  if (!pgClient) {
    console.warn('[calendarStore] pgSet skipped: no pgClient');
    return false;
  }
  try {
    // insert a new history row (preserve previous versions)
    await pgClient.query(
      `INSERT INTO kv_store_history(key, value) VALUES($1, $2)`,
      [key, JSON.parse(value)]
    );
    console.log('[calendarStore] pgInsert success', key);
    return true;
  } catch (e) {
    console.error('[calendarStore] pgInsert failed:', (e as any)?.message || e, (e as any)?.stack || '');
    return false;
  }
}
// --- end Neon support ---

type CalendarEvent = {
  id: string;
  subject: string;
  room: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  location?: {
    displayName: string;
  };
  description?: string;
};

// Use a writable directory by default (prefer user-specified env var).
// In serverless environments (Vercel) the project dir (e.g. /var/task) is
// read-only — use OS tmpdir instead. Consumers may override with
// `CALENDAR_CACHE_PATH` env var to point to a persistent store on self-hosts.
function getStorageFile() {
  const base = process.env.CALENDAR_CACHE_PATH || path.join(os.tmpdir(), 'classroom_reservation');
  return path.join(base, 'public-calendar.json');
}

let cachedEvents: CalendarEvent[] = [];
let lastFetched: number | null = null;
let intervalHandle: NodeJS.Timeout | null = null;
let initialized = false;

const formatEvents = (events: Record<string, any>) => {
  return Object.values(events)
    .filter((event): event is any => event.type === 'VEVENT')
    .map(event => {
      const [, room, eventName] = event.summary?.match(/\[(\d+)\]\s*(.*)/) || [null, '', event.summary];
      return {
        id: event.uid,
        subject: eventName,
        room: room,
        start: {
          dateTime: event.start.toISOString(),
          timeZone: 'Asia/Tokyo'
        },
        end: {
          dateTime: event.end.toISOString(),
          timeZone: 'Asia/Tokyo'
        },
        location: event.location ? { displayName: event.location } : undefined,
        description: event.description
      } as CalendarEvent;
    });
};

async function loadFromDisk() {
  try {
    // Try Neon first
    if (useNeon) {
      const raw = await pgGet('public-calendar');
      if (raw) {
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          cachedEvents = parsed.events || [];
          lastFetched = parsed.lastFetched ?? Date.now();
          return;
        } catch (e) {
          console.warn('Failed to parse Neon cache, falling back to disk:', e);
        }
      }
    }

    // Fallback to disk
    const file = getStorageFile();
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(content);
      cachedEvents = parsed.events || [];
      lastFetched = parsed.lastFetched ?? Date.now();
    }
  } catch (e) {
    console.warn('loadFromDisk error:', e);
  }
}

async function saveToDisk() {
  try {
    const payload = JSON.stringify({ events: cachedEvents, lastFetched });
    // Try Neon first
    if (useNeon) {
      console.log('[calendarStore] attempting pgSet (neon enabled)', { key: 'public-calendar', eventsCount: cachedEvents.length });
      try {
        const ok = await pgSet('public-calendar', payload);
        console.log('[calendarStore] pgSet result', { ok });
      } catch (e) {
        console.warn('Failed to save to Neon, will try disk:', e);
      }
    }

    // Always also try to persist to disk (useful for local/CI)
    const file = getStorageFile();
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, payload, 'utf8');
    console.log('[calendarStore] saved to disk:', file);
  } catch (e) {
    console.warn('saveToDisk error:', e);
  }
}

async function backupExistingStorage() {
  try {
    const storageFile = getStorageFile();
    // if no file, nothing to backup
    // use fs.promises for async/await-compatible API
    await fs.promises.stat(storageFile);
    const bakPath = `${storageFile}.bak`;
    // copy (overwrite) backup using promises API
    await fs.promises.copyFile(storageFile, bakPath);
    console.log('Backed up existing calendar cache to', bakPath);
  } catch (e) {
    // ignore if file doesn't exist or stat fails
  }
}

async function fetchTextWithTimeout(url: string, timeoutMs: number, headers = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    console.log(`[calendarStore] fetching ${url} timeout=${timeoutMs}`);
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text;
  } finally {
    clearTimeout(id);
  }
}

export async function fetchAndStore(calendarUrl: string, opts?: { timeoutMs?: number; retries?: number }) {
  const timeoutMs = opts?.timeoutMs ?? Number(process.env.CALENDAR_FETCH_TIMEOUT_MS ?? 120000);
  const retries = opts?.retries ?? Number(process.env.CALENDAR_FETCH_RETRIES ?? 3);
  for (let i = 1; i <= retries; i++) {
    try {
      const txt = await fetchTextWithTimeout(calendarUrl, timeoutMs);
      // declare eventsObj used by multiple parse branches
      let eventsObj: Record<string, any> = {};
      // Prefer parse functions if available
      // @ts-ignore
      if (typeof ical.parseICS === 'function') {
        // @ts-ignore
        eventsObj = ical.parseICS(txt) as Record<string, any>;
      } else if (typeof (ical as any).parse === 'function') {
        // @ts-ignore
        eventsObj = (ical as any).parse(txt) as Record<string, any>;
      } else {
        // As a last resort, try node-ical.fromURL (which uses axios internally)
        console.warn('node-ical parse API not present; falling back to library fromURL');
        // some node-ical exports async.fromURL — guard access with optional chaining
        // @ts-ignore
        eventsObj = (ical.async?.fromURL ? await ical.async.fromURL(calendarUrl) : {}) as Record<string, any>;
      }

      const formatted = formatEvents(eventsObj as Record<string, any>);

      // If the fetched result is empty but we already have cached events,
      // prefer keeping the previous cache rather than overwriting it with
      // an empty set (which may occur on transient network/parse errors).
      if ((!formatted || formatted.length === 0) && cachedEvents && cachedEvents.length > 0) {
        console.warn('Fetched calendar was empty; keeping existing cached events');
        // Ensure an on-disk backup exists (in case previous cache was only in-memory)
        try {
          await backupExistingStorage();
          // Persist current in-memory cache to disk to ensure durability
          await saveToDisk();
        } catch (e) {
          console.error('Failed to ensure disk backup/persist of previous cache:', e);
        }
        return { ok: true, count: cachedEvents.length, keptPrevious: true };
      }

      // Normal path: we have parsed events to replace cache.
      // Back up any existing on-disk cache before overwriting.
      try {
        await backupExistingStorage();
      } catch (e) {
        // non-fatal
      }

      cachedEvents = formatted;
      lastFetched = Date.now();
      await saveToDisk();
      console.log(`[calendarStore] fetchAndStore success attempt=${i}`);
      return { ok: true, count: cachedEvents.length };
    } catch (err: any) {
      console.warn(`[calendarStore] ICS fetch attempt ${i} failed:`, err?.message || err);
      if (i === retries) return { ok: false, error: err?.message || String(err) };
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i))); // exponential backoff
    }
  }
}

export function getEvents() {
  return cachedEvents.slice();
}

export function getLastFetched() {
  return lastFetched;
}

export async function initStore(calendarUrl: string, intervalMs = 5 * 60 * 1000) {
  if (initialized) return;
  initialized = true;
  await loadFromDisk();

  // kick off initial fetch if no cache exists
  if (!cachedEvents || cachedEvents.length === 0) {
    // don't await to avoid blocking startup; perform and log
    fetchAndStore(calendarUrl).then(r => {
      if (!r.ok) console.error('Initial calendar fetch failed:', r.error);
    });
  }

  // start interval
  intervalHandle = setInterval(() => {
    fetchAndStore(calendarUrl).then(r => {
      if (!r.ok) console.error('Scheduled calendar fetch failed:', r.error);
    });
  }, intervalMs);
}

export async function shutdownStore() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  initialized = false;
  await saveToDisk();
}

export default {
  initStore,
  fetchAndStore,
  getEvents,
  getLastFetched,
  shutdownStore
};
