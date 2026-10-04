// Google Calendar — manual OAuth2 via GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
// Works on any host (Railway, Supabase, etc.) — no Replit-specific dependencies.
import { googleFetch } from "./googleAuth";
import { logger } from "./logger";

const CAL_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary";
const SHOP_EMAIL = "contact@vividpei.com";
const SHOP_OPEN_HOUR = 9;
const LATEST_START_HOUR = 16;
const MAX_BOOKINGS_PER_DAY = 3;

export interface CalendarEventInput {
  summary: string;
  description: string;
  startIso: string;
  durationHours: number;
  id?: string;
  bookingId?: string;
}

/** Creates a Google Calendar event and returns the event ID (or null on failure). */
export async function createCalendarEvent(input: CalendarEventInput): Promise<string | null> {
  const startDate = new Date(input.startIso);
  const endDate = new Date(startDate.getTime() + input.durationHours * 60 * 60 * 1000);

  const body = JSON.stringify({
    ...(input.id ? { id: input.id } : {}),
    ...(input.bookingId ? { extendedProperties: { private: { bookingId: input.bookingId } } } : {}),
    summary: input.summary,
    description: input.description,
    start: { dateTime: startDate.toISOString(), timeZone: "America/Halifax" },
    end: { dateTime: endDate.toISOString(), timeZone: "America/Halifax" },
    attendees: [{ email: SHOP_EMAIL }],
    reminders: { useDefault: true },
  });

  try {
    const res = await googleFetch(`${CAL_BASE}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 409 && input.id && input.bookingId) {
      const existing = await googleFetch(`${CAL_BASE}/events/${encodeURIComponent(input.id)}`);
      if (!existing.ok) return null;
      const event = await existing.json() as { id?: string; status?: string; extendedProperties?: { private?: { bookingId?: string } } };
      if (event.status === "cancelled" || event.extendedProperties?.private?.bookingId !== input.bookingId) return null;
      const patch = JSON.parse(body);
      delete patch.id;
      const updated = await googleFetch(`${CAL_BASE}/events/${encodeURIComponent(input.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
        signal: AbortSignal.timeout(20000),
      });
      return updated.ok ? event.id ?? null : null;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn({ status: res.status, text }, "Google Calendar event creation failed");
      return null;
    }
    const data = await res.json() as { id?: string };
    logger.info({ summary: input.summary, eventId: data.id }, "Google Calendar event created");
    return data.id ?? null;
  } catch (err) {
    logger.error({ err }, "Failed to create Google Calendar event");
    return null;
  }
}

/** Updates an existing Google Calendar event's time, summary and description. */
export async function updateCalendarEvent(eventId: string, input: Pick<CalendarEventInput, "startIso" | "durationHours"> & Partial<Pick<CalendarEventInput, "summary" | "description">>): Promise<boolean> {
  const startDate = new Date(input.startIso);
  const endDate = new Date(startDate.getTime() + input.durationHours * 60 * 60 * 1000);

  const body = JSON.stringify({
    summary: input.summary,
    description: input.description,
    start: { dateTime: startDate.toISOString(), timeZone: "America/Halifax" },
    end: { dateTime: endDate.toISOString(), timeZone: "America/Halifax" },
  });

  try {
    const res = await googleFetch(`${CAL_BASE}/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn({ status: res.status, text, eventId }, "Google Calendar event update failed");
    } else {
      logger.info({ eventId, summary: input.summary }, "Google Calendar event updated");
    }
    return res.ok;
  } catch (err) {
    logger.error({ err, eventId }, "Failed to update Google Calendar event");
    return false;
  }
}

/** Deletes a Google Calendar event by ID. */
export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  try {
    const res = await googleFetch(`${CAL_BASE}/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok && res.status !== 410) {
      const text = await res.text().catch(() => "");
      logger.warn({ status: res.status, text, eventId }, "Google Calendar event delete failed");
    } else {
      logger.info({ eventId }, "Google Calendar event deleted");
    }
    return res.ok || res.status === 410 || res.status === 404;
  } catch (err) {
    logger.error({ err, eventId }, "Failed to delete Google Calendar event");
    return false;
  }
}

/**
 * Searches for a "Vivid Detailing" calendar event within ±10 minutes of the
 * given datetime. Returns the event ID if found, null otherwise.
 * Used as a fallback for bookings that predate calendarEventId storage.
 */
export async function findCalendarEventNear(dt: Date): Promise<string | null> {
  const windowMs = 10 * 60 * 1000;
  const timeMin = new Date(dt.getTime() - windowMs).toISOString();
  const timeMax = new Date(dt.getTime() + windowMs).toISOString();
  const url = `${CAL_BASE}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;
  try {
    const res = await googleFetch(url);
    if (!res.ok) return null;
    const data = await res.json() as { items?: { id?: string; summary?: string }[] };
    const match = (data.items ?? []).find(e => e.summary?.includes("Vivid Detailing"));
    return match?.id ?? null;
  } catch {
    return null;
  }
}

export interface TimeSlot {
  start: string;
  end: string;
  label: string;
  available: boolean;
  bookingsToday: number;
}

export interface NextAvailableSlot {
  date: string;
  start: string;
  end: string;
  label: string;
  bookingsToday: number;
}

export async function getAvailableSlots(
  date: string,
  durationHours: number,
  strict = false,
): Promise<TimeSlot[]> {
  const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
  if (dayOfWeek === 0) return [];

  const dayStart = new Date(`${date}T00:00:00Z`).toISOString();
  const dayEnd = new Date(`${date}T23:59:59Z`).toISOString();
  const url = `${CAL_BASE}/events?timeMin=${encodeURIComponent(dayStart)}&timeMax=${encodeURIComponent(dayEnd)}&singleEvents=true&orderBy=startTime`;

  let events: { start: { dateTime?: string; date?: string } }[] = [];
  try {
    const res = await googleFetch(url);
    if (res.ok) {
      const data = await res.json() as { items?: typeof events };
      events = data?.items ?? [];
    } else {
      if (strict) throw new Error("Calendar availability could not be verified.");
      const text = await res.text().catch(() => "");
      logger.warn({ status: res.status, text, date }, "Google Calendar availability fetch failed");
    }
  } catch (err) {
    if (strict) throw err;
    logger.warn({ err, date }, "Google Calendar availability fetch error — returning all slots open");
    events = [];
  }

  const bookingsToday = events.filter(e => e.start?.dateTime).length;
  const dayFull = bookingsToday >= MAX_BOOKINGS_PER_DAY;

  const slots: TimeSlot[] = [];
  for (let hour = SHOP_OPEN_HOUR; hour <= LATEST_START_HOUR; hour++) {
    const hh = String(hour).padStart(2, "0");
    const totalEndHours = hour + durationHours;
    const endHH = String(Math.floor(totalEndHours)).padStart(2, "0");
    const endMM = String(Math.round((totalEndHours % 1) * 60)).padStart(2, "0");
    slots.push({
      start: `${hh}:00`,
      end: `${endHH}:${endMM}`,
      label: formatHour(hour),
      available: !dayFull,
      bookingsToday,
    });
  }
  return slots;
}

export async function getNextAvailableSlots(
  durationHours: number,
  count: number = 3,
  strict = false,
): Promise<NextAvailableSlot[]> {
  const results: NextAvailableSlot[] = [];
  const nowHalifax = currentHalifaxDate();
  const todayStr = toDateStr(nowHalifax);
  const cursor = new Date(nowHalifax);
  cursor.setHours(0, 0, 0, 0);

  const maxDays = 60;
  let daysTried = 0;

  while (results.length < count && daysTried < maxDays) {
    const dateStr = toDateStr(cursor);
    const isToday = dateStr === todayStr;
    const slots = await getAvailableSlots(dateStr, durationHours, strict);

    for (const slot of slots) {
      if (!slot.available) continue;
      if (isToday) {
        const [slotHour] = slot.start.split(":").map(Number);
        if (slotHour <= nowHalifax.getHours()) continue;
      }
      results.push({ date: dateStr, start: slot.start, end: slot.end, label: slot.label, bookingsToday: slot.bookingsToday });
      break;
    }

    cursor.setDate(cursor.getDate() + 1);
    daysTried++;
  }

  return results;
}

function currentHalifaxDate(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Halifax" }));
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatHour(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${suffix}`;
}
