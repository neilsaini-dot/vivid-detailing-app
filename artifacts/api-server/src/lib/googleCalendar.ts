import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const CALENDAR_ID = "primary";
const CAL_BASE = `/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}`;
const SHOP_OPEN_HOUR = 9;        // Earliest booking start: 9 am
const LATEST_START_HOUR = 16;    // Latest booking start: 4 pm (end time is unrestricted)
const MAX_BOOKINGS_PER_DAY = 3;

export interface CalendarEventInput {
  summary: string;
  description: string;
  startIso: string;
  durationHours: number;
}

export async function createCalendarEvent(input: CalendarEventInput): Promise<void> {
  const connectors = new ReplitConnectors();
  const startDate = new Date(input.startIso);
  const endDate = new Date(startDate.getTime() + input.durationHours * 60 * 60 * 1000);

  try {
    const res = await connectors.proxy(
      "google-calendar",
      `${CAL_BASE}/events`,
      {
        method: "POST",
        body: JSON.stringify({
          summary: input.summary,
          description: input.description,
          start: { dateTime: startDate.toISOString(), timeZone: "America/Halifax" },
          end: { dateTime: endDate.toISOString(), timeZone: "America/Halifax" },
        }),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ status: res.status, body }, "Google Calendar event creation returned non-200");
    } else {
      logger.info({ summary: input.summary }, "Google Calendar event created");
    }
  } catch (err) {
    logger.error({ err }, "Failed to create Google Calendar event");
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

/** Fetch all timed events for a given date and return slot availability. */
export async function getAvailableSlots(
  date: string,
  durationHours: number
): Promise<TimeSlot[]> {
  // Closed Sundays — return no slots
  const dayOfWeek = new Date(`${date}T12:00:00`).getDay(); // 0 = Sunday
  if (dayOfWeek === 0) return [];

  const connectors = new ReplitConnectors();

  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);

  const eventsResponse = await connectors.proxy(
    "google-calendar",
    `${CAL_BASE}/events?timeMin=${dayStart.toISOString()}&timeMax=${dayEnd.toISOString()}&singleEvents=true&orderBy=startTime`,
    { method: "GET" }
  );

  let events: { start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string } }[] = [];
  try {
    const data = await eventsResponse.json() as any;
    events = data?.items ?? [];
  } catch {
    events = [];
  }

  // Count only timed events (ignore all-day blocks like "closed" markers)
  const bookingsToday = events.filter(e => e.start?.dateTime).length;
  const dayFull = bookingsToday >= MAX_BOOKINGS_PER_DAY;

  const slots: TimeSlot[] = [];

  // Generate one slot per hour from SHOP_OPEN_HOUR to LATEST_START_HOUR.
  // No end-time restriction — jobs can run as long as needed.
  for (let hour = SHOP_OPEN_HOUR; hour <= LATEST_START_HOUR; hour++) {
    const hh = String(hour).padStart(2, "0");
    const totalEndHours = hour + durationHours;
    const endHH = String(Math.floor(totalEndHours)).padStart(2, "0");
    const endMM = String(Math.round((totalEndHours % 1) * 60)).padStart(2, "0");

    const startLabel = formatHour(hour);

    slots.push({
      start: `${hh}:00`,
      end: `${endHH}:${endMM}`,
      label: startLabel,
      available: !dayFull,
      bookingsToday,
    });
  }

  return slots;
}

/**
 * Find the next `count` available days and return the earliest open slot for each.
 * One slot per day, across `count` separate days.
 * Skips Sundays, fully-booked days, and past slots for today.
 */
export async function getNextAvailableSlots(
  durationHours: number,
  count: number = 3
): Promise<NextAvailableSlot[]> {
  const results: NextAvailableSlot[] = [];

  // Current time in Halifax (Atlantic Time)
  const nowHalifax = currentHalifaxDate();
  const todayStr = toDateStr(nowHalifax);

  let cursor = new Date(nowHalifax);
  cursor.setHours(0, 0, 0, 0);

  const maxDays = 60;
  let daysTried = 0;

  while (results.length < count && daysTried < maxDays) {
    const dateStr = toDateStr(cursor);
    const isToday = dateStr === todayStr;

    const slots = await getAvailableSlots(dateStr, durationHours);

    // Pick only the first available slot on this day
    for (const slot of slots) {
      if (!slot.available) continue;

      // For today: skip slots whose start hour has already passed (leave 1 hr buffer)
      if (isToday) {
        const [slotHour] = slot.start.split(":").map(Number);
        const currentHour = nowHalifax.getHours();
        if (slotHour <= currentHour) continue;
      }

      // Take the earliest valid slot for this day and move to the next day
      results.push({ date: dateStr, start: slot.start, end: slot.end, label: slot.label, bookingsToday: slot.bookingsToday });
      break;
    }

    cursor.setDate(cursor.getDate() + 1);
    daysTried++;
  }

  return results;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function currentHalifaxDate(): Date {
  // Returns a Date object whose .getHours() / .getDate() etc. reflect Halifax local time
  const halifaxStr = new Date().toLocaleString("en-US", { timeZone: "America/Halifax" });
  return new Date(halifaxStr);
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatHour(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${suffix}`;
}
