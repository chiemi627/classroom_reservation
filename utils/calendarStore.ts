import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import ical from 'node-ical';

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
    // Attempt to create directory in a writable location. On platforms
    // like Vercel the default project dir is read-only, so prefer tmpdir.
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(storageFile, JSON.stringify({ fetchedAt: lastFetched, events: cachedEvents }, null, 2), 'utf-8');
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

export async function fetchAndStore(calendarUrl: string) {
  try {
    // Some environments (Vercel) may fail when node-ical's internal fetch (axios)
    // encounters very large responses. Work around by fetching the ICS text
    // ourselves using the global fetch (or falling back) and then parsing it
    // with node-ical's parser to avoid axios maxContentLength issues.
    let eventsObj: Record<string, any> | null = null;

    try {
      if (typeof fetch === 'function') {
        const controller = new AbortController();
        const timeoutMs = 30_000; // 30s
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const resp = await fetch(calendarUrl, { signal: controller.signal });
        clearTimeout(timeout);

        if (!resp.ok) throw new Error(`Failed to fetch ICS: ${resp.status} ${resp.statusText}`);
        const txt = await resp.text();
        // node-ical exposes a parseICS-like function; use it if available.
        // `ical.parseICS` exists in many versions; guard access to avoid TS error.
        // @ts-ignore
        if (typeof ical.parseICS === 'function') {
          // @ts-ignore
          eventsObj = ical.parseICS(txt) as Record<string, any>;
        } else if (typeof (ical as any).parse === 'function') {
          // older/newer variants
          // @ts-ignore
          eventsObj = (ical as any).parse(txt) as Record<string, any>;
        } else {
          // fallback to library fetch if parsing API not available
          eventsObj = await ical.async.fromURL(calendarUrl) as Record<string, any>;
        }
      } else {
        // no global fetch available — use node-ical's built-in fromURL
        eventsObj = await ical.async.fromURL(calendarUrl) as Record<string, any>;
      }
    } catch (innerErr) {
      console.warn('Primary ICS fetch/parse path failed, falling back to node-ical.fromURL:', innerErr);
      // final fallback
      eventsObj = await ical.async.fromURL(calendarUrl) as Record<string, any>;
    }

    const formatted = formatEvents(eventsObj as Record<string, any>);
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
