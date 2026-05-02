import { ReplitConnectors } from "@replit/connectors-sdk";

const CALENDAR_ID = "primary";
const SHOP_OPEN_HOUR = 8;
const SHOP_CLOSE_HOUR = 18;
// Max vehicles accepted per day via online booking
const MAX_BOOKINGS_PER_DAY = 3;

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
