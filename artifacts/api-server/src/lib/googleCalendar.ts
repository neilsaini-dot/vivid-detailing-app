import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const CALENDAR_ID = "primary";
const SHOP_OPEN_HOUR = 8;
const SHOP_CLOSE_HOUR = 18;
// Max vehicles accepted per day via online booking
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
      `/calendars/${encodeURIComponent(CALENDAR_ID)}/events`,
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

export async function getAvailableSlots(
  date: string,
  durationHours: number
): Promise<TimeSlot[]> {
  const connectors = new ReplitConnectors();

  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);

  // Fetch all events for the day to count total bookings
  const eventsResponse = await connectors.proxy(
    "google-calendar",
    `/calendars/${encodeURIComponent(CALENDAR_ID)}/events?timeMin=${dayStart.toISOString()}&timeMax=${dayEnd.toISOString()}&singleEvents=true&orderBy=startTime`,
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

  for (let hour = SHOP_OPEN_HOUR; hour + durationHours <= SHOP_CLOSE_HOUR; hour++) {
    const hh = String(hour).padStart(2, "0");
    const totalEndHours = hour + durationHours;
    const endHH = String(Math.floor(totalEndHours)).padStart(2, "0");
    const endMM = String(Math.round((totalEndHours % 1) * 60)).padStart(2, "0");

    slots.push({
      start: `${hh}:00`,
      end: `${endHH}:${endMM}`,
      label: `${hh}:00`,
      available: !dayFull,
      bookingsToday,
    });
  }

  return slots;
}
