import fs from 'fs/promises';
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
    // Try Vercel KV first (shared across instances) when enabled
    if (useVercelKV) {
      try {
        const raw = await kvGet('public-calendar');
        if (raw) {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (Array.isArray(parsed.events)) {
            cachedEvents = parsed.events;
            lastFetched = parsed.fetchedAt || Date.now();
            return;
          }
        }
      } catch (e) {
        console.warn('Failed to load cache from Vercel KV, falling back to disk:', (e as any)?.message || e);
      }
    }

    // Fallback: read from local disk (tmpdir or CALENDAR_CACHE_PATH)
    const storageFile = getStorageFile();
    const txt = await fs.readFile(storageFile, 'utf-8');
    const parsed = JSON.parse(txt);
    if (Array.isArray(parsed.events)) {
      cachedEvents = parsed.events;
      lastFetched = parsed.fetchedAt || Date.now();
    }
  } catch (e) {
    // ignore if file doesn't exist or parse error
  }
}

async function saveToDisk() {
  try {
    const storageFile = getStorageFile();
    const dir = path.dirname(storageFile);
    const payloadObj = { fetchedAt: lastFetched, events: cachedEvents };
    const payload = JSON.stringify(payloadObj, null, 2);

    // Try to persist to Vercel KV when available (shared across instances)
    if (useVercelKV) {
      try {
        await kvSet('public-calendar', payload);
      } catch (e) {
        console.warn('Failed to save cache to Vercel KV, will attempt disk write:', (e as any)?.message || e);
      }
    }

    // Always also try to persist to disk when writable (useful for local/CI)
    await fs.mkdir(dir, { recursive: true });
    // Write atomically: write to a temp file then rename.
    const tmpPath = `${storageFile}.tmp-${Date.now()}`;
    await fs.writeFile(tmpPath, payload, 'utf-8');
    await fs.rename(tmpPath, storageFile);
  } catch (e) {
    // Don't throw — caching failure shouldn't break the app. Provide a
    // helpful log message explaining the likely cause and a mitigation.
    console.error('Failed to write calendar cache to disk:', e);
    if ((e as any)?.code === 'EACCES' || (e as any)?.code === 'ENOENT') {
      console.error('Cache write failed — target path may be read-only.\n' +
        'If running on Vercel or other serverless platforms, set CALENDAR_CACHE_PATH\n' +
        "to a writable path (like process.env.TMPDIR or '/tmp') or use an external store (S3/Redis/Vercel KV).\n"
      );
    }
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

export async function fetchAndStore(calendarUrl: string, opts?: { timeoutMs?: number; retries?: number }) {
  try {
    // Some environments (Vercel) may fail when node-ical's internal fetch (axios)
    // encounters very large responses. Work around by fetching the ICS text
    // ourselves using the global fetch (or falling back) and then parsing it
    // with node-ical's parser to avoid axios maxContentLength issues.
    let eventsObj: Record<string, any> | null = null;

  // Configuration via env, overridable per-call via opts
  const fetchTimeoutMs = Number(opts?.timeoutMs ?? process.env.CALENDAR_FETCH_TIMEOUT_MS ?? 60000); // 60s default
  const maxRetries = Number(opts?.retries ?? process.env.CALENDAR_FETCH_RETRIES ?? 3);

    const tryFetchTextWithRetries = async (url: string) => {
      let attempt = 0;
      const backoff = (n: number) => 200 * Math.pow(2, n); // 200ms, 400ms, 800ms...
      while (attempt < maxRetries) {
        attempt += 1;
        try {
          if (typeof fetch !== 'function') throw new Error('global fetch not available');
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
          const resp = await fetch(url, { signal: controller.signal });
          clearTimeout(timeout);
          if (!resp.ok) throw new Error(`Failed to fetch ICS: ${resp.status} ${resp.statusText}`);
          const txt = await resp.text();
          return txt;
        } catch (err) {
          // If aborted or network error, retry with backoff
          const isAbort = (err as any)?.name === 'AbortError' || (err as any)?.code === 'ECONNRESET';
          console.warn(`ICS fetch attempt ${attempt} failed:`, err?.message || err);
          if (attempt >= maxRetries) throw err;
          await new Promise(res => setTimeout(res, backoff(attempt)));
        }
      }
      throw new Error('Exceeded fetch retries');
    };

    try {
      // First try: fetch text with retries, then parse locally
      const txt = await tryFetchTextWithRetries(calendarUrl);
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
    } catch (innerErr) {
      console.warn('Primary ICS fetch/parse path failed, falling back to axios manual fetch:', innerErr);
      // Try to fetch via axios directly (give it generous limits) and parse the text
      try {
        // lazy-require axios to avoid adding it to runtime if not present
        // but axios is already a dependency of node-ical; require it here.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const axios = require('axios');
        const resp = await axios.get(calendarUrl, {
          responseType: 'text',
          timeout: fetchTimeoutMs,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          headers: {
            'User-Agent': 'classroom-reservation-fetch/1.0 (+https://example)' // friendly UA
          }
        });
        const txt = resp.data as string;
        // @ts-ignore
        if (typeof ical.parseICS === 'function') {
          // @ts-ignore
          eventsObj = ical.parseICS(txt) as Record<string, any>;
        } else if (typeof (ical as any).parse === 'function') {
          // @ts-ignore
          eventsObj = (ical as any).parse(txt) as Record<string, any>;
        } else {
          // as a last, last resort, call fromURL
          eventsObj = await ical.async.fromURL(calendarUrl) as Record<string, any>;
        }
      } catch (axiosErr) {
        console.error('Fallback axios fetch/parse also failed:', axiosErr);
        throw axiosErr;
      }
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
    return { ok: true, count: cachedEvents.length };
  } catch (err) {
    console.error('fetchAndStore error:', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
