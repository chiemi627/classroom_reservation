import fs from 'fs/promises';
import path from 'path';
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

const storageFile = path.join(process.cwd(), 'cache', 'public-calendar.json');

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
    await fs.mkdir(path.dirname(storageFile), { recursive: true });
    await fs.writeFile(storageFile, JSON.stringify({ fetchedAt: lastFetched, events: cachedEvents }, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write calendar cache to disk:', e);
  }
}

export async function fetchAndStore(calendarUrl: string) {
  try {
    const eventsObj = await ical.async.fromURL(calendarUrl);
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
