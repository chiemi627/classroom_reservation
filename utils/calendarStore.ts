import fs from 'fs';
import path from 'path';
import os from 'os';
import ical from 'node-ical';

// --- Vercel KV support (dynamic, optional) ---
let kvClient: any = null;
const useVercelKV = Boolean(process.env.USE_VERCEL_KV || process.env.VERCEL_KV);

async function ensureKV() {
  if (kvClient || !useVercelKV) return;
  try {
    // dynamic import so local dev / CI without the package doesn't crash
    // the code will gracefully fallback to disk when KV is unavailable.
    // @ts-ignore
    const mod = await import('@vercel/kv');
    // module may export { kv } or default; try common shapes
    // @ts-ignore
    kvClient = mod.kv ?? mod.default?.kv ?? mod.default ?? null;
  } catch (e) {
    console.warn('Vercel KV not available:', (e as any)?.message || e);
    kvClient = null;
  }
}

async function kvGet(key: string) {
  await ensureKV();
  if (!kvClient) return null;
  try {
    return await kvClient.get(key);
  } catch (e) {
    console.warn('kv.get failed:', (e as any)?.message || e);
    return null;
  }
}

async function kvSet(key: string, value: string) {
  await ensureKV();
  if (!kvClient) return;
  try {
    await kvClient.set(key, value);
  } catch (e) {
    console.warn('kv.set failed:', (e as any)?.message || e);
  }
}

// --- end Vercel KV support ---

// --- Neon / Postgres support (dynamic, optional) ---
let pgClient: any = null;
const useNeon = Boolean(process.env.USE_NEON);

async function ensureNeon() {
  if (pgClient || !useNeon) return;
  try {
    // dynamic import so local dev without pg doesn't crash
    // @ts-ignore
    const { Client } = await import('pg');
    const client = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    pgClient = client;
    // ensure table exists (idempotent)
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
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
    const r = await pgClient.query('SELECT value FROM kv_store WHERE key = $1', [key]);
    if (r.rows.length === 0) return null;
    console.log('[calendarStore] pgGet HIT', key);
    return r.rows[0].value;
  } catch (e) {
    console.warn('[calendarStore] pgGet failed:', e?.message || e);
    return null;
  }
}

async function pgSet(key: string, value: string) {
  await ensureNeon();
  if (!pgClient) return;
  try {
    await pgClient.query(
      `INSERT INTO kv_store(key, value) VALUES($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.parse(value)]
    );
    console.log('[calendarStore] pgSet success', key);
  } catch (e) {
    console.warn('[calendarStore] pgSet failed:', e?.message || e);
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
      try {
        await pgSet('public-calendar', payload);
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
    await fs.stat(storageFile);
    const bakPath = `${storageFile}.bak`;
    // copy (overwrite) backup
    await fs.copyFile(storageFile, bakPath);
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
        eventsObj = await ical.async.fromURL(calendarUrl) as Record<string, any>;
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
