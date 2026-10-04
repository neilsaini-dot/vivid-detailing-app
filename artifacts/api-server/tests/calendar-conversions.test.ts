import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID } from "node:crypto";
import { db, pool, bookingsTable, bookingItemsTable, aiBookingConversionsTable, customersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AdminListCalendarBookingConversionsResponse, AdminSaveCalendarBookingConversionBody } from "@workspace/api-zod";
import { CalendarConversionError, calendarBookingId, calendarMonthRange, classifyCalendarSource, linkGoogleSourceEvent,
  readGoogleSourceEvents, verifyCalendarOnly, type CalendarOwner, type GoogleSourceEvent } from "../src/lib/calendarBookingSources";
import { convertCalendarBooking, saveCalendarBookingConversion, readCalendarConversion,
  listCalendarBookingConversions, verifyCalendarBookingWebhook } from "../src/lib/calendarBookingConversions";
import { GhlAppointmentApiError, listGhlCalendarEvents } from "../src/lib/ghlAppointments";
import { GhlConversionDeliveryError } from "../src/lib/ghl";
import { AiConversionError } from "../src/lib/aiBookingConversion";

after(async () => { await pool.end(); });
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function rollback(fn: (tx: Tx) => Promise<void>) {
  const stop = new Error("intentional rollback");
  try { await db.transaction(async tx => { await fn(tx); throw stop; }); }
  catch (cause) { if (cause !== stop) throw cause; }
}
const event = (): GoogleSourceEvent => ({
  id: randomUUID(), summary: "Synthetic manual detail",
  start: { dateTime: "2027-01-12T09:00:00-04:00" }, end: { dateTime: "2027-01-12T12:00:00-04:00" },
});
const body = () => AdminSaveCalendarBookingConversionBody.parse({
  customer: { name: "Synthetic Calendar Customer", email: `${randomUUID()}@example.invalid`, phone: "+19025550123" },
  vehicle: { type: "car", year: null, make: "", model: "", colour: "" }, notes: "",
  serviceName: "Staff-entered service", startTime: "2027-01-12T09:00:00", endTime: "2027-01-12T12:00:00",
  totalEstimate: 230, confirmedCalendarOnly: false,
});
const effects = (source: GoogleSourceEvent, overrides: Record<string, unknown> = {}) => ({
  getEvent: async () => source, verify: async () => "calendar" as const,
  linkCalendar: async () => {}, webhook: async () => {}, ...overrides,
});
const owner = (override: Partial<CalendarOwner> = {}): CalendarOwner => ({
  id: randomUUID(), eventId: null, appointmentAt: new Date("2027-01-12T13:00:00Z"),
  customerName: null, phone: null, email: null, conversionOrigin: null, conversionState: null, ghlAppointmentId: null, ...override,
});

test("source filtering excludes IDs, metadata and legacy app matches, but not title alone", () => {
  const e = event();
  assert.equal(classifyCalendarSource(e, [owner({ eventId: e.id })], []), "app");
  const linked = owner();
  assert.equal(classifyCalendarSource({ ...e, extendedProperties: { private: { bookingId: linked.id } } }, [linked], []), "app");
  assert.equal(classifyCalendarSource({ ...e, description: `Booking ID: ${linked.id}` }, [linked], []), "app");
  assert.equal(classifyCalendarSource({ ...e, summary: "Vivid Detailing - Sample Person" }, [owner({ customerName: "Sample Person" })], []), "app");
  assert.equal(classifyCalendarSource({ ...e, summary: "Vivid Detailing - Standalone customer" }, [], []), "calendar");
});
test("HighLevel source metadata and external identifiers cannot be manually overridden", async () => {
  const e = event();
  const ghl = [{ id: "synthetic-ghl", startTime: e.start!.dateTime!, googleEventId: e.id }];
  assert.equal(classifyCalendarSource(e, [], ghl), "highlevel");
  assert.equal(classifyCalendarSource({ ...e, extendedProperties: { shared: { source: "GoHighLevel", ghlAppointmentId: "external" } } }, [], []), "highlevel");
  assert.equal(classifyCalendarSource({ ...e, description: "GoHighLevel appointment: deleted-appointment" }, [], []), "highlevel");
  await rollback(async tx => {
    await assert.rejects(() => verifyCalendarOnly(e, true, tx, async () => ghl), CalendarConversionError);
  });
});
test("time-only collisions require source review instead of being claimed as HighLevel", async () => {
  const e = event();
  const ghl = [{ id: "synthetic-ghl", startTime: e.start!.dateTime!, title: "Different customer appointment" }];
  assert.equal(classifyCalendarSource(e, [], ghl), "needs_review");
  assert.equal(classifyCalendarSource(e, [owner()], []), "needs_review");
  await rollback(async tx => {
    await assert.rejects(() => verifyCalendarOnly(e, false, tx, async () => ghl), CalendarConversionError);
    assert.equal(await verifyCalendarOnly(e, true, tx, async () => ghl), "needs_review");
  });
});
test("Halifax month boundaries use local offsets and exclusive next-month midnight", () => {
  assert.equal(calendarMonthRange("2027-01").start.toISOString(), "2027-01-01T04:00:00.000Z");
  assert.equal(calendarMonthRange("2027-07").end.toISOString(), "2027-08-01T03:00:00.000Z");
  assert.equal(calendarMonthRange("2026-11").start.toISOString(), "2026-11-01T03:00:00.000Z");
  assert.equal(calendarMonthRange("2026-11").end.toISOString(), "2026-12-01T04:00:00.000Z");
  assert.throws(() => calendarMonthRange("2027-13"), CalendarConversionError);
});
test("Google listing follows every page, includes all-day bookings, and excludes cancelled/system events", async () => {
  const first = event(), second = event();
  const calls: string[] = [];
  const data = await readGoogleSourceEvents("2027-01", async url => {
    calls.push(url);
    return Response.json(calls.length === 1 ? { items: [first], nextPageToken: "page2" }
      : { items: [second, { ...event(), start: { date: "2027-01-13" } },
        { ...event(), status: "cancelled" }, { ...event(), eventType: "workingLocation" }] });
  });
  assert.equal(data.length, 3);
  assert.match(calls[1], /pageToken=page2/);
  assert.match(calls[0], /singleEvents=true/);
  await assert.rejects(() => readGoogleSourceEvents("2027-01", async () => new Response("", { status: 403 })), CalendarConversionError);
  await assert.rejects(() => readGoogleSourceEvents("2027-01", async () => Response.json({ items: [], nextPageToken: "repeated" })), CalendarConversionError);
});
test("HighLevel discovery reads every calendar including non-specials and fails closed on denied access", async () => {
  const calls: string[] = [];
  const rows = await listGhlCalendarEvents(new Date("2027-01-01"), new Date("2027-02-01"), {
    token: "synthetic-token", locationId: "synthetic-location",
    fetcher: async input => {
      const url = String(input); calls.push(url);
      return Response.json(url.includes("/calendars/?") ? { calendars: [{ id: "manual" }, { id: "unrelated-special" }] }
        : { events: [{ id: new URL(url).searchParams.get("calendarId"), startTime: "2027-01-12T13:00:00Z" }] });
    },
  });
  assert.equal(rows.length, 2);
  assert.equal(calls.length, 3);
  assert.match(calls[1], /calendarId=/);
  await assert.rejects(() => listGhlCalendarEvents(new Date(), new Date(), {
    token: "synthetic-token", locationId: "synthetic-location", fetcher: async () => new Response("", { status: 403 }),
  }), GhlAppointmentApiError);
});
test("Google adoption only PATCHes the original, preserves metadata, and requests no attendee notifications", async () => {
  const e = { ...event(), extendedProperties: { private: { existing: "keep" }, shared: { shared: "keep" } } };
  const calls: { url: string; method: string; body?: any }[] = [];
  await linkGoogleSourceEvent(e.id, { bookingId: calendarBookingId(e.id), summary: "Native title", description: "Native description",
    startTime: "2027-01-12T13:00:00Z", endTime: "2027-01-12T16:00:00Z" }, async (url, init) => {
    const payload = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", body: payload });
    return Response.json(payload ? { ...e, ...payload } : e);
  });
  assert.deepEqual(calls.map(c => c.method), ["GET", "PATCH"]);
  assert.match(calls[1].url, /sendUpdates=none/);
  assert.equal(calls[1].body.extendedProperties.private.existing, "keep");
  assert.equal(calls[1].body.extendedProperties.shared.shared, "keep");
  await assert.rejects(() => linkGoogleSourceEvent(e.id, { bookingId: calendarBookingId(e.id), summary: "", description: "", startTime: "", endTime: "" },
    async () => Response.json({ ...e, extendedProperties: { private: { bookingId: randomUUID() } } })), CalendarConversionError);
});
test("empty all-day review can be saved with no invented person, vehicle, price or confirmation", async () => {
  await rollback(async tx => {
    const e = { ...event(), summary: "", description: "", start: { date: "2027-01-12" }, end: { date: "2027-01-13" } };
    const input = { ...body(), customer: { name: "", email: "", phone: "" },
      vehicle: { type: null, year: null, make: "", model: "", colour: "" }, totalEstimate: null,
      startTime: "", endTime: "", serviceName: "" };
    let network = 0;
    const fx = effects(e, { linkCalendar: async () => { network++; }, webhook: async () => { network++; } });
    const saved = await saveCalendarBookingConversion(e.id, input, tx, fx);
    assert.equal(network, 0);
    assert.equal(saved.review!.customer.name, "");
    assert.equal(saved.review!.vehicle.type, null);
    assert.equal(saved.review!.totalEstimate, null);
    assert.equal(saved.start, "2027-01-12");
    const record = (await readCalendarConversion(e.id, tx))!;
    assert.equal(record.booking.vehicleId, null);
    assert.equal(record.booking.totalEstimate, null);
    assert.equal(record.booking.appointmentAt, null);
    await assert.rejects(() => convertCalendarBooking(e.id, input, tx, fx), AiConversionError);
  });
});
test("editable review changes price, service and every detail on the same booking; confirmation runs once", async () => {
  await rollback(async tx => {
    const e = event(), input = body();
    const calls: string[] = [];
    const fx = effects(e, {
      linkCalendar: async (id: string, update: any) => {
        calls.push("calendar"); assert.equal(id, e.id); assert.equal(update.bookingId, calendarBookingId(e.id));
        assert.match(update.description, /Edited service/); assert.match(update.description, /345.00/);
      },
      webhook: async (payload: any, key: string) => {
        calls.push("webhook");
        assert.equal(payload.event, "booking_confirmed"); assert.equal(payload.booking.total_estimate, 345);
        assert.equal(payload.booking.is_quote_based, false); assert.equal(payload.booking.id, calendarBookingId(e.id));
        assert.equal(payload.contact.firstName, "Changed"); assert.equal(key, `calendar-conversion:${calendarBookingId(e.id)}`);
        assert.equal(payload.booking.ghl_appointment_id, undefined);
      },
    });
    const first = await saveCalendarBookingConversion(e.id, input, tx, fx);
    const edited = { ...input, totalEstimate: 345, serviceName: "Edited service", notes: "Edited notes",
      customer: { ...input.customer, name: "Changed Customer", phone: "+19025550999" },
      vehicle: { type: "suv" as const, year: 2022, make: "Synthetic", model: "Test", colour: "Black" },
      startTime: "2027-01-13T09:00:00", endTime: "2027-01-13T14:30:00" };
    const saved = await saveCalendarBookingConversion(e.id, edited, tx, fx);
    assert.equal(saved.bookingId, first.bookingId);
    assert.deepEqual(calls, []);
    const result = await convertCalendarBooking(e.id, edited, tx, fx);
    assert.equal(result.conversionState, "converted");
    assert.equal(result.webhookState, "sent");
    assert.equal(result.reviewLocked, true);
    assert.equal(result.review!.totalEstimate, 345);
    assert.equal(result.review!.vehicle.year, 2022);
    assert.deepEqual(calls, ["calendar", "webhook"]);
    await convertCalendarBooking(e.id, { ...edited, totalEstimate: 99 }, tx, fx);
    assert.deepEqual(calls, ["calendar", "webhook"]);
    const record = (await readCalendarConversion(e.id, tx))!;
    assert.equal(record.booking.calendarEventId, e.id);
    assert.equal(record.booking.totalEstimate, "345.00");
    assert.equal(record.booking.status, "confirmed");
    const items = await tx.select().from(bookingItemsTable).where(eq(bookingItemsTable.bookingId, record.booking.id));
    assert.equal(items.length, 1);
    assert.equal(items[0].unitPrice, "300.00");
    await assert.rejects(() => saveCalendarBookingConversion(e.id, edited, tx, fx), CalendarConversionError);
  });
});
test("null price is not silently free; explicit zero is valid and malformed details fail before effects", async () => {
  await rollback(async tx => {
    const e = event(), input = body();
    let linked = 0;
    const fx = effects(e, { linkCalendar: async () => { linked++; } });
    for (const invalid of [
      { ...input, totalEstimate: null }, { ...input, totalEstimate: -1 }, { ...input, totalEstimate: 1.001 },
      { ...input, serviceName: "" }, { ...input, vehicle: { ...input.vehicle, type: null } },
      { ...input, startTime: "" }, { ...input, endTime: input.startTime },
    ]) await assert.rejects(() => convertCalendarBooking(e.id, invalid, tx, fx));
    assert.equal(linked, 0);
    const result = await convertCalendarBooking(e.id, { ...input, totalEstimate: 0 }, tx, fx);
    assert.equal(result.review!.totalEstimate, 0); assert.equal(linked, 1);
  });
});
test("source-verification failure cannot be bypassed by a manual checkbox and creates no booking", async () => {
  await rollback(async tx => {
    const e = event();
    const fx = effects(e, { verify: async () => { throw new GhlAppointmentApiError(424, "Source unavailable"); } });
    await assert.rejects(() => saveCalendarBookingConversion(e.id, { ...body(), confirmedCalendarOnly: true }, tx, fx), GhlAppointmentApiError);
    assert.equal(await readCalendarConversion(e.id, tx), undefined);
  });
});
test("calendar failure keeps review editable and prevents confirmation", async () => {
  await rollback(async tx => {
    const e = event(), input = body();
    let confirmations = 0;
    await assert.rejects(() => convertCalendarBooking(e.id, input, tx, effects(e, {
      linkCalendar: async () => { throw new CalendarConversionError(424, "Google unavailable"); },
      webhook: async () => { confirmations++; },
    })), CalendarConversionError);
    assert.equal(confirmations, 0);
    const updated = await saveCalendarBookingConversion(e.id, { ...input, totalEstimate: 115 }, tx, effects(e));
    assert.equal(updated.reviewLocked, false);
    assert.equal(updated.review!.totalEstimate, 115);
  });
});
test("known webhook rejection freezes details, resumes without repeating calendar, and sends once successfully", async () => {
  await rollback(async tx => {
    const e = event(), input = body(); let calendars = 0, hooks = 0;
    const fx = effects(e, { linkCalendar: async () => { calendars++; },
      webhook: async () => { hooks++; if (hooks === 1) throw new GhlConversionDeliveryError(false, "Rejected"); } });
    await assert.rejects(() => convertCalendarBooking(e.id, input, tx, fx), CalendarConversionError);
    const row = (await readCalendarConversion(e.id, tx))!;
    assert.equal(row.conversion.webhookState, "pending");
    await assert.rejects(() => saveCalendarBookingConversion(e.id, { ...input, totalEstimate: 999 }, tx, fx), CalendarConversionError);
    const result = await convertCalendarBooking(e.id, input, tx, fx);
    assert.equal(result.conversionState, "converted"); assert.equal(calendars, 1); assert.equal(hooks, 2);
  });
});
test("uncertain confirmation is blocked until staff verifies delivery; delivered receipt is never resent", async () => {
  await rollback(async tx => {
    const e = event(), input = body(); let hooks = 0;
    const fx = effects(e, { webhook: async () => { hooks++; throw new Error("Unknown response"); } });
    await assert.rejects(() => convertCalendarBooking(e.id, input, tx, fx), CalendarConversionError);
    assert.equal((await readCalendarConversion(e.id, tx))!.conversion.webhookState, "uncertain");
    await assert.rejects(() => convertCalendarBooking(e.id, input, tx, fx), CalendarConversionError);
    await assert.rejects(() => verifyCalendarBookingWebhook(e.id, false, true, tx), CalendarConversionError);
    const verified = await verifyCalendarBookingWebhook(e.id, true, true, tx);
    assert.equal(verified.webhookState, "sent");
    const resumed = await convertCalendarBooking(e.id, input, tx, fx);
    assert.equal(resumed.conversionState, "converted"); assert.equal(hooks, 1);
  });
});
test("uncertain not-delivered verification permits one retry without creating a second booking", async () => {
  await rollback(async tx => {
    const e = event(), input = body(); let hooks = 0;
    const fx = effects(e, { webhook: async () => { hooks++; if (hooks === 1) throw new Error("Network timeout"); } });
    await assert.rejects(() => convertCalendarBooking(e.id, input, tx, fx), CalendarConversionError);
    await verifyCalendarBookingWebhook(e.id, true, false, tx);
    const result = await convertCalendarBooking(e.id, input, tx, fx);
    assert.equal(result.bookingId, calendarBookingId(e.id)); assert.equal(hooks, 2);
  });
});
test("pending source's own app marker is allowed for retry, while unrelated native ownership is excluded", async () => {
  await rollback(async tx => {
    const e = event(), input = body();
    await saveCalendarBookingConversion(e.id, input, tx, effects(e));
    const own = owner({ id: calendarBookingId(e.id), eventId: e.id, conversionOrigin: "google_calendar", conversionState: "failed" });
    const patched = { ...e, description: `Booking ID: ${own.id}`, extendedProperties: { private: { bookingId: own.id } } };
    assert.equal(classifyCalendarSource(patched, [own], []), "calendar");
    assert.equal(classifyCalendarSource(patched, [{ ...own, conversionState: "converted" }], []), "app");
  });
});
test("listing separates source-review candidates, retains saved reviews and exposes converted receipts", async () => {
  await rollback(async tx => {
    const e = event(), candidate = event(), converted = event();
    candidate.start!.dateTime = "2027-01-15T13:00:00Z";
    converted.start!.dateTime = "2027-01-18T13:00:00Z";
    converted.end!.dateTime = "2027-01-18T16:00:00Z";
    await saveCalendarBookingConversion(e.id, body(), tx, effects(e));
    await convertCalendarBooking(converted.id, { ...body(), startTime: converted.start!.dateTime, endTime: converted.end!.dateTime! }, tx, effects(converted));
    const listed = await listCalendarBookingConversions("2027-01", tx, {
      google: async () => [e, candidate, converted],
      ghl: async () => [{ id: "synthetic-ghl", startTime: candidate.start!.dateTime! }],
    });
    assert.equal(listed.events.length, 1);
    assert.equal(listed.events[0].review!.serviceName, "Staff-entered service");
    assert.equal(listed.needsSourceReview.length, 1);
    assert.equal(listed.converted.length, 1);
    assert.equal(listed.converted[0].bookingId, calendarBookingId(converted.id));
    assert.doesNotThrow(() => AdminListCalendarBookingConversionsResponse.parse(listed));
  });
});
test("matching an existing customer by email and phone does not create duplicate customer profiles", async () => {
  await rollback(async tx => {
    const input = body();
    const [customer] = await tx.insert(customersTable).values(input.customer).returning();
    const e = event();
    await saveCalendarBookingConversion(e.id, input, tx, effects(e));
    assert.equal((await readCalendarConversion(e.id, tx))!.booking.customerId, customer.id);
  });
});