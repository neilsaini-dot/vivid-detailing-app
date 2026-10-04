import { db, bookingsTable, customersTable, vehiclesTable, bookingItemsTable,
  serviceHistoryTable, aiBookingConversionsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { AdminSaveCalendarBookingConversionBody } from "@workspace/api-zod";
import { validateReview } from "./aiBookingConversion";
import { parseSpecialDate } from "./ghlSpecialBookings";
import { syncSpecialLoyalty } from "./ghlSpecialIntake";
import { GhlConversionDeliveryError, sendGhlConversionConfirmed, type GhlBookingConfirmedPayload } from "./ghl";
import { listGhlCalendarEvents } from "./ghlAppointments";
import {
  CalendarConversionError, SOURCE_CALENDAR, calendarBookingId, calendarMonthRange, classifyCalendarSource, eventMonth,
  readCalendarOwners, readGoogleSourceEvent, readGoogleSourceEvents, linkGoogleSourceEvent, verifyCalendarOnly,
  type GoogleSourceEvent,
} from "./calendarBookingSources";

type Review = ReturnType<typeof AdminSaveCalendarBookingConversionBody.parse>;
type Database = Pick<typeof db, "select" | "transaction">;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type RecordRow = { booking: typeof bookingsTable.$inferSelect; conversion: typeof aiBookingConversionsTable.$inferSelect };
type Metadata = { kind: "google-calendar-conversion"; review: Review; calendarLinked: boolean };
const defaults = { getEvent: readGoogleSourceEvent, verify: verifyCalendarOnly,
  linkCalendar: linkGoogleSourceEvent, webhook: sendGhlConversionConfirmed };
type Effects = typeof defaults;
function fail(status: number, message: string): never { throw new CalendarConversionError(status, message); }
function metadata(row: RecordRow): Metadata {
  try {
    const value = JSON.parse(row.booking.internalNotes ?? "") as Metadata;
    if (value.kind !== "google-calendar-conversion" || typeof value.calendarLinked !== "boolean") throw new Error("Invalid metadata");
    value.review = AdminSaveCalendarBookingConversionBody.parse(value.review);
    return value;
  } catch { return fail(503, "Calendar review metadata could not be read. Do not retry confirmation until staff resolves the saved review."); }
}
function normalize(body: Review, converting: boolean): Review {
  const cleaned = validateReview({ ...body, vehicle: { ...body.vehicle, type: body.vehicle.type ?? "car" } }, converting);
  if (converting && body.vehicle.type === null) fail(422, "Select the vehicle type before conversion.");
  const start = parseSpecialDate(body.startTime || undefined, "Appointment start");
  const end = parseSpecialDate(body.endTime || undefined, "Appointment end");
  const serviceName = body.serviceName.trim();
  if (converting && (!serviceName || /^(null|undefined|untitled calendar booking)$/i.test(serviceName) || /\{\{[^{}]*\}\}/.test(serviceName))) {
    fail(422, "Enter the service being booked.");
  }
  if (converting && body.totalEstimate === null) fail(422, "Enter the total including HST before conversion.");
  if ((start && end && end <= start) || (converting && (!start || !end))) {
    fail(422, "Enter a valid appointment start and a later end time.");
  }
  return { ...cleaned, vehicle: { ...cleaned.vehicle, type: body.vehicle.type },
    serviceName, startTime: start?.toISOString() ?? "", endTime: end?.toISOString() ?? "",
    totalEstimate: body.totalEstimate, confirmedCalendarOnly: body.confirmedCalendarOnly };
}
function signature(review: Review) {
  return JSON.stringify([review.customer, review.vehicle, review.notes, review.serviceName,
    review.startTime, review.endTime, review.totalEstimate]);
}
export async function readCalendarConversion(id: string, database: Pick<typeof db, "select"> = db) {
  const [row] = await database.select({ booking: bookingsTable, conversion: aiBookingConversionsTable })
    .from(bookingsTable).innerJoin(aiBookingConversionsTable, eq(bookingsTable.id, aiBookingConversionsTable.bookingId))
    .where(and(eq(bookingsTable.id, calendarBookingId(id)), eq(aiBookingConversionsTable.botOrigin, "google_calendar"))).limit(1);
  return row;
}
export function calendarConversionResult(event: GoogleSourceEvent, row?: RecordRow) {
  const saved = row ? metadata(row) : null;
  const htmlUrl = event.htmlLink && /^https:\/\/(?:calendar\.google\.com|www\.google\.com\/calendar)(?:\/|$)/i.test(event.htmlLink)
    ? event.htmlLink : null;
  return { id: event.id, title: event.summary || "Untitled calendar booking",
    description: event.description ?? null, location: event.location ?? null, htmlUrl,
    start: event.start?.dateTime ?? event.start?.date ?? null, end: event.end?.dateTime ?? event.end?.date ?? null,
    allDay: !event.start?.dateTime, bookingId: row?.booking.id ?? null, review: saved?.review ?? null,
    reviewLocked: !!saved?.calendarLinked || row?.conversion.state === "processing" || row?.conversion.state === "converted"
      || (!!row && row.conversion.webhookState !== "pending"),
    conversionState: row?.conversion.state ?? "review", webhookState: row?.conversion.webhookState ?? "pending",
    lastError: row?.conversion.lastError ?? null, convertedAt: row?.conversion.convertedAt?.toISOString() ?? null };
}
function savedEvent(id: string, row: RecordRow): GoogleSourceEvent {
  const review = metadata(row).review;
  return { id, summary: review.serviceName,
    start: { dateTime: review.startTime }, end: { dateTime: review.endTime } };
}
export async function listCalendarBookingConversions(month: string, database: Database = db,
  readers = { google: readGoogleSourceEvents, ghl: listGhlCalendarEvents }) {
  const range = calendarMonthRange(month);
  const googleEvents = await readers.google(month);
  const sourceMonths = [...new Set([month, ...googleEvents.map(eventMonth)])];
  const readGhl = async () => {
    const result = [];
    for (let offset = 0; offset < sourceMonths.length; offset += 4) {
      const batches = await Promise.all(sourceMonths.slice(offset, offset + 4).map(sourceMonth => {
        const window = calendarMonthRange(sourceMonth);
        return readers.ghl(window.start, window.end);
      }));
      result.push(...batches.flat());
    }
    return result;
  };
  const [ghlEvents, owners, records] = await Promise.all([
    readGhl(), readCalendarOwners(database),
    database.select({ booking: bookingsTable, conversion: aiBookingConversionsTable }).from(bookingsTable)
      .innerJoin(aiBookingConversionsTable, eq(bookingsTable.id, aiBookingConversionsTable.bookingId))
      .where(eq(aiBookingConversionsTable.botOrigin, "google_calendar")),
  ]);
  const recordsByEvent = new Map(records.map(row => [row.booking.calendarEventId!, row]));
  const events: ReturnType<typeof calendarConversionResult>[] = [];
  const needsSourceReview: ReturnType<typeof calendarConversionResult>[] = [];
  const converted: ReturnType<typeof calendarConversionResult>[] = [];
  for (const event of googleEvents) {
    const row = recordsByEvent.get(event.id);
    if (row?.conversion.state === "converted") continue;
    const source = classifyCalendarSource(event, owners, ghlEvents);
    if (source === "app" || source === "highlevel") continue;
    const view = calendarConversionResult(event, row);
    (source === "needs_review" ? needsSourceReview : events).push(view);
  }
  for (const row of records) {
    if (!row.booking.calendarEventId) continue;
    const date = row.booking.appointmentAt;
    if (!date || date < range.start || date >= range.end) continue;
    const view = calendarConversionResult(savedEvent(row.booking.calendarEventId, row), row);
    if (row.conversion.state === "converted") converted.push(view);
    else if (!googleEvents.some(event => event.id === row.booking.calendarEventId)) {
      // Keep interrupted receipts visible even when the source was removed or moved.
      events.push({ ...view, lastError: view.lastError ?? "The source event is not in this month's calendar result. Retry will verify its current existence and source." });
    }
  }
  return { month, calendarId: SOURCE_CALENDAR, events, needsSourceReview, converted };
}

async function resolveCustomer(tx: Tx, body: Review, existingId?: string | null) {
  const email = body.customer.email || null;
  const phone = body.customer.phone || null;
  const digits = phone?.replace(/\D/g, "") ?? "";
  for (const identity of [email && `email:${email}`, digits && `phone:${digits}`].filter(Boolean).sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
  }
  const matches = new Map<string, typeof customersTable.$inferSelect>();
  if (existingId) {
    const [customer] = await tx.select().from(customersTable).where(eq(customersTable.id, existingId)).for("update");
    if (!customer) fail(409, "The linked customer no longer exists.");
    matches.set(customer.id, customer);
  } else {
    if (email) for (const customer of await tx.select().from(customersTable).where(sql`lower(trim(${customersTable.email})) = ${email}`).limit(2)) matches.set(customer.id, customer);
    if (digits) for (const customer of await tx.select().from(customersTable).where(sql`regexp_replace(${customersTable.phone}, '[^0-9]', '', 'g') = ${digits}`).limit(2)) matches.set(customer.id, customer);
    if (matches.size > 1) fail(409, "Customer email and phone identify multiple profiles. Resolve the conflict before conversion.");
  }
  const current = [...matches.values()][0];
  const values = { name: body.customer.name || null, email, phone };
  if (current) {
    const [customer] = await tx.update(customersTable).set(values).where(eq(customersTable.id, current.id)).returning();
    return customer;
  }
  const [customer] = await tx.insert(customersTable).values(values).returning();
  return customer;
}
async function saveReview(tx: Tx, event: GoogleSourceEvent, review: Review, converting: boolean) {
  const id = calendarBookingId(event.id);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([SOURCE_CALENDAR, event.id])}, 0))`);
  const previous = await readCalendarConversion(event.id, tx);
  if (previous?.conversion.state === "converted") {
    if (converting) return previous;
    fail(409, "This event is already converted. Edit it in the Bookings tab.");
  }
  if (previous?.conversion.state === "processing" && previous.conversion.claimedAt
    && Date.now() - previous.conversion.claimedAt.getTime() < 120000) fail(409, "Conversion is running. Refresh to check its receipt.");
  if (["sending", "uncertain"].includes(previous?.conversion.webhookState ?? "")) {
    fail(409, "Verify booking-confirmed delivery in HighLevel automation history before retrying.");
  }
  if (previous && !["pending", "confirmed"].includes(previous.booking.status)) fail(409, "Cancelled or started jobs cannot be converted.");
  if (previous && (metadata(previous).calendarLinked || previous.conversion.webhookState === "sent")) {
    if (signature(normalize(metadata(previous).review, false)) !== signature(review)) fail(409, "Conversion already started. Resume using the saved details without changing price or other fields.");
    return previous;
  }
  const customer = await resolveCustomer(tx, review, previous?.booking.customerId);
  let vehicleId = previous?.booking.vehicleId;
  if (review.vehicle.type !== null) {
    const vehicle = { ...review.vehicle, type: review.vehicle.type, make: review.vehicle.make || null, model: review.vehicle.model || null, colour: review.vehicle.colour || null };
    if (vehicleId) {
      const [saved] = await tx.update(vehiclesTable).set(vehicle).where(eq(vehiclesTable.id, vehicleId)).returning();
      if (!saved) fail(409, "The linked vehicle no longer exists.");
    } else {
      const [saved] = await tx.insert(vehiclesTable).values({ ...vehicle, customerId: customer.id }).returning();
      vehicleId = saved.id;
    }
  }
  const values = { customerId: customer.id, vehicleId, calendarEventId: event.id,
    appointmentAt: review.startTime ? new Date(review.startTime) : null,
    totalEstimate: review.totalEstimate === null ? null : review.totalEstimate.toFixed(2),
    isManualPriceOverride: review.totalEstimate !== null, createdByAdmin: true,
    notes: review.notes || null, internalNotes: JSON.stringify({ kind: "google-calendar-conversion", review, calendarLinked: false } satisfies Metadata) };
  let booking;
  if (previous) [booking] = await tx.update(bookingsTable).set(values).where(eq(bookingsTable.id, id)).returning();
  else [booking] = await tx.insert(bookingsTable).values({ id, ...values, source: "other", status: "pending" }).returning();
  const line = { itemName: review.serviceName || event.summary || "Calendar booking", itemType: "service",
    unitPrice: review.totalEstimate === null ? null : (review.totalEstimate / 1.15).toFixed(2), quantity: 1, isQuoteBased: review.totalEstimate === null };
  if (previous) await tx.update(bookingItemsTable).set(line).where(eq(bookingItemsTable.bookingId, id));
  else {
    await tx.insert(bookingItemsTable).values({ ...line, bookingId: id });
    await tx.insert(serviceHistoryTable).values({ bookingId: id, customerId: customer.id });
  }
  await tx.insert(aiBookingConversionsTable).values({ bookingId: id, botOrigin: "google_calendar", calendarEventId: event.id })
    .onConflictDoNothing({ target: aiBookingConversionsTable.bookingId });
  return (await readCalendarConversion(event.id, tx))!;
}
export async function saveCalendarBookingConversion(id: string, body: Review, database: Database = db, effects: Effects = defaults) {
  const review = normalize(body, false);
  const event = await effects.getEvent(id);
  await effects.verify(event, review.confirmedCalendarOnly, database);
  const saved = await database.transaction(tx => saveReview(tx, event, review, false));
  return calendarConversionResult(event, saved);
}

function confirmationPayload(row: RecordRow) {
  const review = metadata(row).review;
  const name = review.customer.name.split(/\s+/);
  const vehicle = [review.vehicle.year, review.vehicle.make, review.vehicle.model].filter(Boolean).join(" ") || review.vehicle.type!;
  const appointment = new Intl.DateTimeFormat("en-US", { timeZone: "America/Halifax", month: "long", day: "2-digit", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(review.startTime));
  const description = [`Customer: ${review.customer.name} | ${review.customer.phone} | ${review.customer.email}`,
    `Vehicle: ${vehicle}`, `Services: ${review.serviceName}`, `Estimated Total (incl. HST): $${review.totalEstimate!.toFixed(2)}`,
    review.notes ? `Notes: ${review.notes}` : null, `Booking ID: ${row.booking.id}`].filter(Boolean).join("\n");
  const payload: GhlBookingConfirmedPayload = {
    event: "booking_confirmed", booking_confirmed: true, source: "vivid-app",
    contact: { firstName: name[0], lastName: name.slice(1).join(" "), email: review.customer.email,
      phone: review.customer.phone, tags: ["Booking", "Vivid Detailing", review.serviceName] },
    opportunity: { title: `${review.serviceName} - ${vehicle}`, status: "won", monetaryValue: review.totalEstimate!,
      pipelineStageName: "Won", notes: description },
    booking: { id: row.booking.id, services: [review.serviceName], addons: [], vehicle,
      appointment_at: appointment, total_estimate: review.totalEstimate!, is_quote_based: false, notes: review.notes || null },
  };
  return { payload, description, review };
}
export async function convertCalendarBooking(id: string, body: Review, database: Database = db, effects: Effects = defaults) {
  const existing = await readCalendarConversion(id, database);
  if (existing?.conversion.state === "converted") return calendarConversionResult(savedEvent(id, existing), existing);
  const review = normalize(body, true);
  const event = await effects.getEvent(id);
  await effects.verify(event, review.confirmedCalendarOnly, database);
  const prepared = await database.transaction(async tx => {
    const row = await saveReview(tx, event, review, true);
    if (row.conversion.state === "converted") return null;
    await tx.update(aiBookingConversionsTable).set({ state: "processing", claimedAt: new Date(), lastError: null })
      .where(eq(aiBookingConversionsTable.bookingId, row.booking.id));
    return row;
  });
  if (!prepared) return calendarConversionResult(event, (await readCalendarConversion(id, database))!);
  const update = async (values: Partial<typeof aiBookingConversionsTable.$inferInsert>) => {
    await database.transaction(tx => tx.update(aiBookingConversionsTable).set(values).where(eq(aiBookingConversionsTable.bookingId, prepared.booking.id)));
  };
  const { payload, description, review: stored } = confirmationPayload(prepared);
  try {
    if (!metadata(prepared).calendarLinked) {
      await effects.linkCalendar(id, { bookingId: prepared.booking.id, summary: `Vivid Detailing - ${stored.customer.name} - ${stored.serviceName}`,
        description, startTime: stored.startTime, endTime: stored.endTime });
      await database.transaction(tx => tx.update(bookingsTable).set({
        internalNotes: JSON.stringify({ ...metadata(prepared), calendarLinked: true }),
      }).where(eq(bookingsTable.id, prepared.booking.id)));
    }
    if (prepared.conversion.webhookState !== "sent") {
      await update({ webhookState: "sending" });
      try { await effects.webhook(payload, `calendar-conversion:${prepared.booking.id}`); }
      catch (cause) {
        const uncertain = !(cause instanceof GhlConversionDeliveryError) || cause.uncertain;
        await update({ state: "failed", webhookState: uncertain ? "uncertain" : "pending",
          lastError: uncertain ? "Confirmation delivery is unverified. Check HighLevel automation history before retrying." : (cause as Error).message });
        fail(502, uncertain ? "Check HighLevel automation history before retrying confirmation." : (cause as Error).message);
      }
      await update({ webhookState: "sent" });
    }
    await database.transaction(async tx => {
      const [booking] = await tx.update(bookingsTable).set({ status: "confirmed" }).where(eq(bookingsTable.id, prepared.booking.id)).returning();
      await syncSpecialLoyalty(tx, booking);
      await tx.update(aiBookingConversionsTable).set({ state: "converted", convertedAt: new Date(), lastError: null })
        .where(eq(aiBookingConversionsTable.bookingId, booking.id));
    });
  } catch (cause) {
    if (cause instanceof CalendarConversionError && cause.status === 502) throw cause;
    await update({ state: "failed", lastError: "Conversion interrupted. Completed steps were retained; review the receipt before retrying." }).catch(() => {});
    if (cause instanceof CalendarConversionError) throw cause;
    fail(502, "Conversion interrupted. Completed steps were retained; refresh and check confirmation delivery before retrying.");
  }
  const result = (await readCalendarConversion(id, database))!;
  return calendarConversionResult(savedEvent(id, result), result);
}
export async function verifyCalendarBookingWebhook(id: string, verifiedInGhl: boolean, delivered: boolean, database: Database = db) {
  if (!verifiedInGhl) fail(422, "Check booking-confirmed delivery in HighLevel automation history first.");
  const row = await database.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([SOURCE_CALENDAR, id])}, 0))`);
    const current = await readCalendarConversion(id, tx);
    if (!current || current.conversion.state === "converted") fail(409, "This calendar booking has no interrupted conversion.");
    if (current.conversion.state === "processing" && current.conversion.claimedAt && Date.now() - current.conversion.claimedAt.getTime() < 120000) fail(409, "Conversion is still running. Wait two minutes before verifying delivery.");
    if (!["sending", "uncertain"].includes(current.conversion.webhookState)) fail(409, "Confirmation delivery does not need verification.");
    await tx.update(aiBookingConversionsTable).set({ state: "failed", webhookState: delivered ? "sent" : "pending",
      lastError: delivered ? "Staff verified confirmation was delivered. Resume without resending." : "Staff verified confirmation was not delivered. Retry conversion." })
      .where(eq(aiBookingConversionsTable.bookingId, current.booking.id));
    return (await readCalendarConversion(id, tx))!;
  });
  return calendarConversionResult(savedEvent(id, row), row);
}