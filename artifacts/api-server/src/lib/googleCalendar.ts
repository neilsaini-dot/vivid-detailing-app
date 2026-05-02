import { ReplitConnectors } from "@replit/connectors-sdk";

const CALENDAR_ID = "primary";
const SHOP_OPEN_HOUR = 8;
const SHOP_CLOSE_HOUR = 18;
// Max concurrent jobs allowed before a slot is considered fully booked
const MAX_CONCURRENT_JOBS = 3;

export interface TimeSlot {
  start: string;
  end: string;
  label: string;
  available: boolean;
  concurrentCount: number;
}

export async function getAvailableSlots(
  date: string,
  durationHours: number
): Promise<TimeSlot[]> {
  const connectors = new ReplitConnectors();

  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);

  // Use events list instead of freeBusy so we can count concurrent bookings
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

  // Normalise events to millisecond timestamps (skip all-day events)
  const eventRanges = events
    .filter(e => e.start?.dateTime && e.end?.dateTime)
    .map(e => ({
      start: new Date(e.start.dateTime!).getTime(),
      end: new Date(e.end.dateTime!).getTime(),
    }));

  const slots: TimeSlot[] = [];
  const durationMs = durationHours * 60 * 60 * 1000;

  for (let hour = SHOP_OPEN_HOUR; hour + durationHours <= SHOP_CLOSE_HOUR; hour++) {
    const slotStart = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`).getTime();
    const slotEnd = slotStart + durationMs;

    // Count how many existing events overlap with this slot window
    const concurrentCount = eventRanges.filter(e => slotStart < e.end && slotEnd > e.start).length;

    const hh = String(hour).padStart(2, "0");
    const totalEndHours = hour + durationHours;
    const endHH = String(Math.floor(totalEndHours)).padStart(2, "0");
    const endMM = String(Math.round((totalEndHours % 1) * 60)).padStart(2, "0");

    slots.push({
      start: `${hh}:00`,
      end: `${endHH}:${endMM}`,
      label: `${hh}:00`,
      available: concurrentCount < MAX_CONCURRENT_JOBS,
      concurrentCount,
    });
  }

  return slots;
}
