import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import { db, pool, bookingsTable, customersTable, vehiclesTable, aiBookingConversionsTable,
  ghlSpecialAppointmentsTable, serviceHistoryTable, loyaltyActivityTable } from "@workspace/db";
import { SyncGhlSpecialBookingBody } from "@workspace/api-zod";
import { syncSpecialAppointment } from "../src/lib/ghlSpecialBookings";
import { SPECIAL_CALENDARS } from "../src/lib/ghlSpecialsConfig";
import { convertAiBooking, saveAiBooking, readAiBookings, resolveAiWebhook, AiConversionError, aiCalendarEventId } from "../src/lib/aiBookingConversion";
import { GhlConversionDeliveryError } from "../src/lib/ghl";
import { createAiBookingsRouter } from "../src/routes/ai-bookings";

after(async () => { await pool.end(); });
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function rollback(fn: (tx: Tx) => Promise<void>) {
  const stop = new Error("intentional rollback");
  try { await db.transaction(async tx => { await fn(tx); throw stop; }); }
  catch (cause) { if (cause !== stop) throw cause; }
}
const review = () => ({
  customer: { name: "Synthetic AI Review", email: "synthetic@example.invalid", phone: "+19025550123" },
  vehicle: { type: "car" as const, year: 2020, make: "Test", model: "Fixture", colour: "Blue" },
  notes: "Synthetic test only",
});
async function imported(tx: Pick<typeof db, "transaction">, ceramic = false) {
  const input = SyncGhlSpecialBookingBody.parse({
    locationId: "synthetic-location", appointmentId: randomUUID(),
    calendarId: ceramic ? SPECIAL_CALENDARS.ceramic : SPECIAL_CALENDARS.detailing, appointmentStatus: "new",
    startTime: "2027-01-12T09:00:00-04:00", endTime: "2027-01-12T15:00:00-04:00", contact: { id: randomUUID() },
  });
  const created = await syncSpecialAppointment(input, tx);
  return { id: created.bookingId!, input };
}

test("review enriches the same booking without external effects; conversion sends normal payload once", async () => {
  await rollback(async tx => {
    for (const ceramic of [false, true]) {
      const { id, input } = await imported(tx, ceramic);
      const body = review();
      await saveAiBooking(id, body, tx);
      let hooks = 0, calendars = 0;
      const effects = {
        webhook: async (payload: any, key: string) => {
          hooks++;
          assert.equal(payload.event, "booking_confirmed");
          assert.equal(payload.source, "vivid-app");
          assert.equal(payload.booking.id, id);
          assert.equal(payload.booking.ghl_appointment_id, input.appointmentId);
          assert.equal(payload.contact.ghlContactId, input.contact!.id);
          assert.equal(payload.contact.firstName, "Synthetic");
          assert.equal(payload.opportunity.status, "won");
          assert.equal(payload.booking.total_estimate, ceramic ? 1144.25 : 228.85);
          assert.equal(key, `ai-conversion:${id}`);
        },
        calendar: async (event: any) => {
          calendars++;
          assert.equal(event.id, aiCalendarEventId(id));
          assert.equal(event.bookingId, id);
          assert.equal(event.startIso, "2027-01-12T13:00:00.000Z");
          assert.equal(event.durationHours, 6);
          return event.id;
        },
      };
      await convertAiBooking(id, body, tx, effects);
      await convertAiBooking(id, body, tx, effects);
      assert.equal(hooks, 1);
      assert.equal(calendars, 1);
      const row = (await readAiBookings(tx)).find(b => b.id === id)!;
      assert.equal(row.conversionState, "converted");
      assert.equal(row.webhookState, "sent");
      assert.equal(row.customer.name, body.customer.name);
      assert.equal(row.vehicle.year, 2020);
      assert.equal(row.ghlAppointmentId, input.appointmentId);
      assert.ok(row.convertedAt);
      await assert.rejects(() => saveAiBooking(id, body, tx), AiConversionError);
    }
  });
});

test("review reprices vehicle types, preserves enriched data on GHL updates, and keeps GHL scheduling", async () => {
  await rollback(async tx => {
    const { id, input } = await imported(tx);
    await saveAiBooking(id, { ...review(), vehicle: { ...review().vehicle, type: "suv" } }, tx);
    assert.equal((await readAiBookings(tx)).find(b => b.id === id)!.totalEstimate, 251.85);
    await syncSpecialAppointment({
      ...input, contact: { id: input.contact!.id, name: "Old GHL name" }, vehicle: { type: "car", year: "2021" },
      startTime: "2027-01-13T09:00:00-04:00", endTime: "2027-01-13T15:00:00-04:00",
    }, tx);
    const row = (await readAiBookings(tx)).find(b => b.id === id)!;
    assert.equal(row.customer.name, review().customer.name);
    assert.equal(row.vehicle.type, "suv");
    assert.equal(row.vehicle.year, 2020);
    assert.equal(row.appointmentAt, "2027-01-13T13:00:00.000Z");
    assert.equal(row.totalEstimate, 251.85);
  });
});

test("calendar failure retries only calendar; a sent webhook locks reviewed data", async () => {
  await rollback(async tx => {
    const { id } = await imported(tx);
    let hooks = 0, calendars = 0;
    const effects = { webhook: async () => { hooks++; }, calendar: async () => { calendars++; return calendars === 1 ? null : "synthetic-calendar"; } };
    await assert.rejects(() => convertAiBooking(id, review(), tx, effects), e => e instanceof AiConversionError && e.status === 502);
    let row = (await readAiBookings(tx)).find(b => b.id === id)!;
    assert.equal(row.conversionState, "failed");
    assert.equal(row.webhookState, "sent");
    await assert.rejects(() => convertAiBooking(id, { ...review(), notes: "different" }, tx, effects), AiConversionError);
    await convertAiBooking(id, review(), tx, effects);
    row = (await readAiBookings(tx)).find(b => b.id === id)!;
    assert.equal(row.conversionState, "converted");
    assert.equal(hooks, 1);
    assert.equal(calendars, 2);
  });
});

test("ambiguous webhook failures require explicit verification; acknowledged delivery is not repeated", async () => {
  await rollback(async tx => {
    const { id } = await imported(tx);
    let calls = 0;
    const effects = { webhook: async () => { calls++; throw new GhlConversionDeliveryError(true, "Synthetic uncertainty"); }, calendar: async () => "synthetic-calendar" };
    await assert.rejects(() => convertAiBooking(id, review(), tx, effects), AiConversionError);
    assert.equal((await readAiBookings(tx)).find(b => b.id === id)!.webhookState, "uncertain");
    await assert.rejects(() => convertAiBooking(id, review(), tx, effects), AiConversionError);
    await assert.rejects(() => resolveAiWebhook(id, false, true, tx), AiConversionError);
    await resolveAiWebhook(id, true, true, tx);
    await convertAiBooking(id, review(), tx, effects);
    assert.equal(calls, 1);
  });
});

test("definite webhook rejection can retry; cancelled, invalid, and processing bookings cannot convert", async () => {
  await rollback(async tx => {
    const { id, input } = await imported(tx);
    let calls = 0;
    const effects = { webhook: async () => { if (++calls === 1) throw new GhlConversionDeliveryError(false, "Synthetic rejection"); }, calendar: async () => "synthetic-calendar" };
    await assert.rejects(() => convertAiBooking(id, { ...review(), customer: { ...review().customer, phone: "" } }, tx, effects), AiConversionError);
    assert.equal(calls, 0);
    await assert.rejects(() => convertAiBooking(id, review(), tx, effects), AiConversionError);
    await convertAiBooking(id, review(), tx, effects);
    assert.equal(calls, 2);
    const another = await imported(tx);
    await syncSpecialAppointment({ ...another.input, appointmentStatus: "cancelled" }, tx);
    await assert.rejects(() => convertAiBooking(another.id, review(), tx, effects), AiConversionError);
    const active = await imported(tx);
    await tx.insert(aiBookingConversionsTable).values({ bookingId: active.id, state: "processing", webhookState: "sending", claimedAt: new Date() });
    await assert.rejects(() => convertAiBooking(active.id, review(), tx, effects), AiConversionError);
    await assert.rejects(() => resolveAiWebhook(active.id, true, false, tx), AiConversionError);
    await tx.update(aiBookingConversionsTable).set({ claimedAt: new Date(Date.now() - 180000) }).where(eq(aiBookingConversionsTable.bookingId, active.id));
    await resolveAiWebhook(active.id, true, false, tx);
    await convertAiBooking(active.id, review(), tx, effects);
  });
});

test("simultaneous conversion requests claim one booking and send one webhook and event", { timeout: 15000 }, async () => {
  const { id } = await imported(db);
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id));
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const pause = new Promise<void>(resolve => { release = resolve; });
  let webhooks = 0, calendars = 0;
  const effects = {
    webhook: async () => { webhooks++; entered(); await pause; },
    calendar: async () => { calendars++; return aiCalendarEventId(id); },
  };
  const first = convertAiBooking(id, review(), db, effects);
  try {
    await Promise.race([ready, first.then(() => assert.fail("Conversion should wait for the webhook receipt"))]);
    await assert.rejects(() => convertAiBooking(id, review(), db, effects),
      e => e instanceof AiConversionError && e.status === 409);
    release();
    await first;
    await convertAiBooking(id, review(), db, effects);
    assert.equal(webhooks, 1);
    assert.equal(calendars, 1);
  } finally {
    release();
    await first.catch(() => {});
    await db.transaction(async tx => {
      await tx.delete(ghlSpecialAppointmentsTable).where(eq(ghlSpecialAppointmentsTable.bookingId, id));
      await tx.delete(serviceHistoryTable).where(eq(serviceHistoryTable.bookingId, id));
      await tx.delete(loyaltyActivityTable).where(eq(loyaltyActivityTable.bookingId, id));
      await tx.delete(bookingsTable).where(eq(bookingsTable.id, id));
      if (booking.vehicleId) await tx.delete(vehiclesTable).where(eq(vehiclesTable.id, booking.vehicleId));
      if (booking.customerId) await tx.delete(customersTable).where(eq(customersTable.id, booking.customerId));
    });
  }
});

test("real HTTP routes list, save, convert, validate, and return the existing booking", async () => {
  await rollback(async tx => {
    const { id } = await imported(tx);
    let hooks = 0;
    const effects = { webhook: async () => { hooks++; }, calendar: async () => "synthetic-calendar" };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.log = { error() {}, warn() {} } as any; next(); });
    app.use(createAiBookingsRouter({
      readAiBookings: () => readAiBookings(tx),
      saveAiBooking: (id, body) => saveAiBooking(id, body, tx),
      convertAiBooking: (id, body) => convertAiBooking(id, body, tx, effects),
      resolveAiWebhook: (id, checked, delivered) => resolveAiWebhook(id, checked, delivered, tx),
      syncAiBookingCalendar: async () => {},
    }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address() as { port: number };
    const root = `http://127.0.0.1:${address.port}/admin/ai-bookings`;
    try {
      assert.equal((await fetch(root)).status, 200);
      const send = (path: string, method: string, body: unknown) => fetch(root + path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      assert.equal((await send(`/${id}`, "PATCH", review())).status, 200);
      assert.equal(hooks, 0);
      assert.equal((await send("/not-a-uuid/convert", "POST", review())).status, 422);
      const converted = await send(`/${id}/convert`, "POST", review());
      assert.equal(converted.status, 200);
      const data = await converted.json() as { id: string; conversionState: string };
      assert.equal(data.id, id);
      assert.equal(data.conversionState, "converted");
      assert.equal((await send(`/${id}/convert`, "POST", review())).status, 200);
      assert.equal(hooks, 1);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});