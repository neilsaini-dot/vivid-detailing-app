import { createHash } from "node:crypto";
import { db, bookingsTable, customersTable, aiBookingConversionsTable, ghlSpecialAppointmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { googleFetch } from "./googleAuth";
import { listGhlCalendarEvents, type GhlCalendarEvent } from "./ghlAppointments";
import { parseSpecialDate } from "./ghlSpecialBookings";

export const SOURCE_CALENDAR = "primary";
const GOOGLE_BASE = `https://www.googleapis.com/calendar/v3/calendars/${SOURCE_CALENDAR}/events`;
export class CalendarConversionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export interface GoogleSourceEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  iCalUID?: string;
  status?: string;
  eventType?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
}
export function calendarBookingId(eventId: string) {
  const hex = createHash("sha256").update(`vivid-calendar-conversion:${SOURCE_CALENDAR}:${eventId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function calendarMonthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1900 || Number(month.slice(0, 4)) > 2200) {
    throw new CalendarConversionError(422, "Choose a valid calendar month.");
  }
  const [year, number] = month.split("-").map(Number);
  const next = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
  return {
    start: parseSpecialDate(`${month}-01T00:00:00`, "month")!,
    end: parseSpecialDate(`${next}-01T00:00:00`, "month")!,
  };
}
export function eventMonth(event: GoogleSourceEvent) {
  if (event.start?.date) return event.start.date.slice(0, 7);
  const date = new Date(event.start?.dateTime ?? "");
  if (!Number.isFinite(date.getTime())) throw new CalendarConversionError(422, "Calendar event has no valid appointment date.");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Halifax", year: "numeric", month: "2-digit" }).formatToParts(date);
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}`;
}
export async function readGoogleSourceEvents(month: string, fetcher: typeof googleFetch = googleFetch) {
  const { start, end } = calendarMonthRange(month);
  const events: GoogleSourceEvent[] = [];
  const seen = new Set<string>();
  let token: string | undefined;
  do {
    const query = new URLSearchParams({
      timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: "true",
      orderBy: "startTime", maxResults: "2500", showDeleted: "false",
    });
    if (token) query.set("pageToken", token);
    const response = await fetcher(`${GOOGLE_BASE}?${query}`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new CalendarConversionError(424, `Google Calendar could not be read (HTTP ${response.status}). No source classification was performed.`);
    const data = await response.json() as { items?: GoogleSourceEvent[]; nextPageToken?: string };
    if (!Array.isArray(data.items)) throw new CalendarConversionError(424, "Google Calendar returned an invalid event list.");
    events.push(...data.items);
    token = data.nextPageToken;
    if (token && seen.has(token)) throw new CalendarConversionError(424, "Google Calendar pagination could not be completed.");
    if (token) seen.add(token);
  } while (token);
  return events.filter(event => event.id && event.status !== "cancelled"
    && (!event.eventType || event.eventType === "default" || event.eventType === "fromGmail"));
}
export async function readGoogleSourceEvent(id: string, fetcher: typeof googleFetch = googleFetch) {
  const response = await fetcher(`${GOOGLE_BASE}/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(20000) });
  if (response.status === 404 || response.status === 410) throw new CalendarConversionError(404, "This Google Calendar event no longer exists.");
  if (!response.ok) throw new CalendarConversionError(424, `Google Calendar event could not be verified (HTTP ${response.status}).`);
  const event = await response.json() as GoogleSourceEvent;
  if (event.id !== id || event.status === "cancelled") throw new CalendarConversionError(409, "Calendar event identity is invalid or the event was cancelled.");
  return event;
}
export async function linkGoogleSourceEvent(id: string, values: {
  bookingId: string; summary: string; description: string; startTime: string; endTime: string;
}, fetcher: typeof googleFetch = googleFetch) {
  const original = await readGoogleSourceEvent(id, fetcher);
  const existingOwner = original.extendedProperties?.private?.bookingId;
  if (existingOwner && existingOwner !== values.bookingId) throw new CalendarConversionError(409, "Another app booking already owns this calendar event.");
  const response = await fetcher(`${GOOGLE_BASE}/${encodeURIComponent(id)}?sendUpdates=none`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      summary: values.summary, description: values.description,
      start: { dateTime: values.startTime, timeZone: "America/Halifax" },
      end: { dateTime: values.endTime, timeZone: "America/Halifax" },
      extendedProperties: {
        ...original.extendedProperties,
        private: { ...original.extendedProperties?.private, bookingId: values.bookingId },
      },
    }),
  });
  if (!response.ok) throw new CalendarConversionError(424, `Google Calendar update failed (HTTP ${response.status}). No confirmation was sent.`);
  const saved = await response.json() as GoogleSourceEvent;
  if (saved.id !== id || saved.status === "cancelled" || saved.extendedProperties?.private?.bookingId !== values.bookingId) {
    throw new CalendarConversionError(424, "Google Calendar did not confirm booking ownership. No confirmation was sent.");
  }
}
export async function readCalendarOwners(database: Pick<typeof db, "select"> = db) {
  return database.select({
    id: bookingsTable.id, eventId: bookingsTable.calendarEventId, appointmentAt: bookingsTable.appointmentAt,
    customerName: customersTable.name, phone: customersTable.phone, email: customersTable.email,
    conversionOrigin: aiBookingConversionsTable.botOrigin, conversionState: aiBookingConversionsTable.state,
    ghlAppointmentId: ghlSpecialAppointmentsTable.appointmentId,
  }).from(bookingsTable)
    .leftJoin(customersTable, eq(bookingsTable.customerId, customersTable.id))
    .leftJoin(aiBookingConversionsTable, eq(bookingsTable.id, aiBookingConversionsTable.bookingId))
    .leftJoin(ghlSpecialAppointmentsTable, eq(bookingsTable.id, ghlSpecialAppointmentsTable.bookingId));
}
export type CalendarOwner = Awaited<ReturnType<typeof readCalendarOwners>>[number];
const normalized = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
export function classifyCalendarSource(event: GoogleSourceEvent, owners: CalendarOwner[], ghlEvents: GhlCalendarEvent[]) {
  const text = `${event.summary ?? ""}\n${event.description ?? ""}`;
  const metadata = { ...event.extendedProperties?.shared, ...event.extendedProperties?.private };
  const ownId = calendarBookingId(event.id);
  const pendingOwn = owners.find(owner => owner.id === ownId && owner.conversionOrigin === "google_calendar" && owner.conversionState !== "converted");
  for (const owner of owners) {
    if (owner === pendingOwn) continue;
    if (owner.eventId === event.id || metadata.bookingId === owner.id || text.includes(`Booking ID: ${owner.id}`)) return "app" as const;
  }
  if (Object.entries(metadata).some(([key, value]) =>
    (/^(source|provider|origin)$/i.test(key) && ["ghl", "gohighlevel", "highlevel", "leadconnector"].includes(normalized(value)))
    || (/^(?:ghl|gohighlevel|highlevel|leadconnector)(?:Appointment|Event)Id$/i.test(key) && !!value && !/^(null|undefined)$/i.test(value))
    || (/^(appointmentId|calendarId)$/i.test(key) && ghlEvents.some(e => e.id === value)))
    || /GoHighLevel appointment\s*:|https?:\/\/[^\s]*(?:gohighlevel|leadconnectorhq)\./i.test(text)) return "highlevel" as const;
  if (ghlEvents.some(ghl => [ghl.id, ghl.googleEventId, ghl.externalCalendarEventId, ghl.iCalUID]
    .some(id => !!id && (id === event.id || id === event.iCalUID || text.includes(id))))) return "highlevel" as const;
  const start = event.start?.dateTime ? new Date(event.start.dateTime).getTime() : null;
  const sameDay = (instant: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Halifax", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
    return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}-${parts.find(p => p.type === "day")!.value}`;
  };
  const matchingGhl = ghlEvents.filter(ghl => start !== null
    ? new Date(ghl.startTime).getTime() === start
    : event.start?.date && sameDay(new Date(ghl.startTime)) === event.start.date);
  if (matchingGhl.some(ghl => ghl.title && normalized(ghl.title).length > 12
    && normalized(ghl.title) === normalized(event.summary ?? ""))) return "highlevel" as const;
  const sameTimeOwners = owners.filter(owner => owner !== pendingOwn && start !== null && owner.appointmentAt?.getTime() === start);
  if (sameTimeOwners.some(owner => {
    const name = normalized(owner.customerName ?? "");
    const email = owner.email?.toLowerCase();
    const digits = owner.phone?.replace(/\D/g, "");
    return (name.length > 3 && normalized(text).includes(name))
      || (email && text.toLowerCase().includes(email))
      || (digits && digits.length >= 7 && text.replace(/\D/g, "").includes(digits));
  })) return "app" as const;
  // A time collision alone is not proof of source. Staff must explicitly check it.
  const sameDayOwner = !event.start?.dateTime && event.start?.date
    && owners.some(owner => owner !== pendingOwn && owner.appointmentAt && sameDay(owner.appointmentAt) === event.start!.date);
  if (matchingGhl.length || sameTimeOwners.length || sameDayOwner) return "needs_review" as const;
  return "calendar" as const;
}
export async function verifyCalendarOnly(event: GoogleSourceEvent, confirmedCalendarOnly: boolean,
  database: Pick<typeof db, "select"> = db, ghlReader = listGhlCalendarEvents) {
  const { start, end } = calendarMonthRange(eventMonth(event));
  const [owners, ghl] = await Promise.all([readCalendarOwners(database), ghlReader(start, end)]);
  const source = classifyCalendarSource(event, owners, ghl);
  if (source === "app" || source === "highlevel") throw new CalendarConversionError(409,
    "This event belongs to an app or HighLevel booking. Use that booking's existing flow instead.");
  if (source === "needs_review" && !confirmedCalendarOnly) throw new CalendarConversionError(422,
    "Check the overlapping app/HighLevel appointment and confirm this is a separate calendar-only booking.");
  return source;
}