// Google Calendar — via Replit Connectors SDK (@replit/connectors-sdk)
// Proxy handles OAuth2 token injection and refresh automatically.
// No GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN needed.
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const CAL_BASE = "/calendar/v3/calendars/primary";
const SHOP_EMAIL = "contact@vividpei.com";
const SHOP_OPEN_HOUR = 9;
const LATEST_START_HOUR = 16;
const MAX_BOOKINGS_PER_DAY = 3;

function getConnectors(): ReplitConnectors {
  return new ReplitConnectors();
}

export interface CalendarEventInput {
  summary: string;
  description: string;
  startIso: string;
  durationHours: number;
}

export async function createCalendarEvent(input: CalendarEventInput): Promise<void> {
  const startDate = new Date(input.startIso);
  const endDate = new Date(startDate.getTime() + input.durationHours * 60 * 60 * 1000);

  const body = JSON.stringify({
    summary: input.summary,
    description: input.description,
    start: { dateTime: startDate.toISOString(), timeZone: "America/Halifax" },
    end: { dateTime: endDate.toISOString(), timeZone: "America/Halifax" },
    attendees: [{ email: SHOP_EMAIL }],
    reminders: { useDefault: true },
  });

  try {
    const connectors = getConnectors();
    const res = await connectors.proxy("google-calendar", `${CAL_BASE}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn({ status: res.status, text }, "Google Calendar event creation failed");
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

export async function getAvailableSlots(
  date: string,
  durationHours: number
): Promise<TimeSlot[]> {
  const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
  if (dayOfWeek === 0) return [];

  const dayStart = new Date(`${date}T00:00:00Z`).toISOString();
  const dayEnd = new Date(`${date}T23:59:59Z`).toISOString();
  const path = `${CAL_BASE}/events?timeMin=${encodeURIComponent(dayStart)}&timeMax=${encodeURIComponent(dayEnd)}&singleEvents=true&orderBy=startTime`;

  let events: { start: { dateTime?: string; date?: string } }[] = [];
  try {
    const connectors = getConnectors();
    const res = await connectors.proxy("google-calendar", path);
    if (res.ok) {
      const data = await res.json() as { items?: typeof events };
      events = data?.items ?? [];
    } else {
      const text = await res.text().catch(() => "");
      logger.warn({ status: res.status, text, date }, "Google Calendar availability fetch failed");
    }
  } catch (err) {
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
  count: number = 3
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
    const slots = await getAvailableSlots(dateStr, durationHours);

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
