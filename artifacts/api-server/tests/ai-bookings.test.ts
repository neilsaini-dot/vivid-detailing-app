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
import { convertAiBooking as convertAiBookingReal, saveAiBooking, readAiBookings as readAiBookingsReal, resolveAiWebhook, AiConversionError, aiCalendarEventId } from "../src/lib/aiBookingConversion";
import { appointmentOrigin, deleteGhlAppointment, getAppointmentOrigin, inspectAppointmentLookup } from "../src/lib/ghlAppointments";
import { isGhlSpecialBooking } from "../src/lib/ghlSpecialBookingOwnership";
import { GhlConversionDeliveryError } from "../src/lib/ghl";
import { createAiBookingsRouter } from "../src/routes/ai-bookings";
import { createGhlSpecialBookingHandler } from "../src/routes/ghl-specials";

after(async () => { await pool.end(); });
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const readAiBookings = (database: Pick<typeof db, "select"> = db) => readAiBookingsReal(database, async () => "chat_bot");
const convertAiBooking = (id: string, body: Parameters<typeof convertAiBookingReal>[1], database: Parameters<typeof convertAiBookingReal>[2],
  effects: Partial<NonNullable<Parameters<typeof convertAiBookingReal>[3]>>) => convertAiBookingReal(id, body, database, {
    webhook: async () => {}, calendar: async () => "synthetic-calendar",
    origin: async () => "chat_bot", deleteAppointment: async () => {}, ...effects,
  });
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
          assert.equal(event.calendarId, "contact@vividpei.com");
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

test("calendar failure preserves GHL and sends no webhook; retry resumes the ordered conversion", async () => {
  await rollback(async tx => {
    const { id } = await imported(tx);
    let hooks = 0, calendars = 0, deletes = 0;
    const effects = { webhook: async () => { hooks++; }, deleteAppointment: async () => { deletes++; },
      calendar: async () => { calendars++; return calendars === 1 ? null : "synthetic-calendar"; } };
    await assert.rejects(() => convertAiBooking(id, review(), tx, effects), e => e instanceof AiConversionError && e.status === 502);
    let row = (await readAiBookings(tx)).find(b => b.id === id)!;
    assert.equal(row.conversionState, "failed");
    assert.equal(row.webhookState, "pending");
    assert.equal(hooks, 0);
    assert.equal(deletes, 0);
    await convertAiBooking(id, review(), tx, effects);
    row = (await readAiBookings(tx)).find(b => b.id === id)!;
    assert.equal(row.conversionState, "converted");
    assert.equal(hooks, 1);
    assert.equal(calendars, 2);
    assert.equal(deletes, 1);
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

test("conversion creates a new contact@ event, deletes GHL, confirms, then transfers scheduling ownership", async () => {
  await rollback(async tx => {
    const { id, input } = await imported(tx);
    await tx.update(bookingsTable).set({ calendarEventId: "old-ghl-google-mirror" }).where(eq(bookingsTable.id, id));
    const steps: string[] = [];
    assert.equal(await isGhlSpecialBooking(id, tx, true), true);
    const effects = {
      calendar: async (event: any) => {
        steps.push("google");
        assert.equal(event.calendarId, "contact@vividpei.com");
        assert.ok(event.summary.startsWith("Vivid Detailing - Synthetic AI Review - "));
        assert.ok(event.description.includes(`Booking ID: ${id}`));
        return event.id;
      },
      deleteAppointment: async (identity: any) => {
        steps.push("delete");
        assert.equal(identity.appointmentId, input.appointmentId);
        const [receipt] = await tx.select().from(aiBookingConversionsTable).where(eq(aiBookingConversionsTable.bookingId, id));
        assert.equal(receipt.calendarEventId, aiCalendarEventId(id));
        assert.equal(receipt.webhookState, "pending");
        const callback = await syncSpecialAppointment({ ...input, appointmentStatus: "cancelled" }, tx);
        assert.equal(callback.action, "ignored");
        assert.equal(callback.status, "pending");
      },
      webhook: async () => {
        steps.push("confirmation");
        const [receipt] = await tx.select().from(aiBookingConversionsTable).where(eq(aiBookingConversionsTable.bookingId, id));
        assert.equal(receipt.ghlDeleteState, "deleted");
        assert.equal(receipt.state, "processing");
      },
    };
    await convertAiBooking(id, review(), tx, effects);
    assert.deepEqual(steps, ["google", "delete", "confirmation"]);
    const row = (await readAiBookings(tx)).find(b => b.id === id)!;
    assert.equal(row.conversionState, "converted");
    assert.equal(row.ghlDeleteState, "deleted");
    assert.equal(row.requiresGhlCleanup, false);
    assert.equal(row.calendarEventId, aiCalendarEventId(id));
    assert.equal(await isGhlSpecialBooking(id, tx, true), false);
    const late = await syncSpecialAppointment({ ...input, startTime: "2027-01-14T09:00:00-04:00",
      endTime: "2027-01-14T15:00:00-04:00" }, tx);
    assert.equal(late.action, "ignored");
    assert.equal((await readAiBookings(tx)).find(b => b.id === id)!.appointmentAt, "2027-01-12T13:00:00.000Z");
    await convertAiBooking(id, review(), tx, effects);
    assert.deepEqual(steps, ["google", "delete", "confirmation"]);
  });
});

test("failed GHL deletion keeps the converted booking and an explicit manual-cleanup flag", async () => {
  await rollback(async tx => {
    const { id } = await imported(tx);
    const steps: string[] = [];
    const effects = {
      calendar: async () => { steps.push("google"); return aiCalendarEventId(id); },
      deleteAppointment: async () => { steps.push("delete"); throw new Error("Synthetic API delete failed"); },
      webhook: async () => { steps.push("confirmation"); },
    };
    await convertAiBooking(id, review(), tx, effects);
    const row = (await readAiBookings(tx)).find(b => b.id === id)!;
    assert.equal(row.conversionState, "converted");
    assert.equal(row.requiresGhlCleanup, true);
    assert.equal(row.ghlDeleteState, "failed");
    assert.equal(row.ghlDeleteError, "Synthetic API delete failed");
    assert.equal(await isGhlSpecialBooking(id, tx, true), false);
    await convertAiBooking(id, review(), tx, effects);
    assert.deepEqual(steps, ["google", "delete", "confirmation"]);
  });
});

test("confirmation retry never recreates Google or repeats the successful GHL delete", async () => {
  await rollback(async tx => {
    const { id } = await imported(tx);
    let calendars = 0, deletes = 0, confirmations = 0;
    const effects = {
      calendar: async () => { calendars++; return aiCalendarEventId(id); },
      deleteAppointment: async () => { deletes++; },
      webhook: async () => { if (++confirmations === 1) throw new GhlConversionDeliveryError(false, "Synthetic rejection"); },
    };
    await assert.rejects(() => convertAiBooking(id, review(), tx, effects), AiConversionError);
    await assert.rejects(() => saveAiBooking(id, { ...review(), notes: "changed after handover" }, tx), AiConversionError);
    await convertAiBooking(id, review(), tx, effects);
    assert.deepEqual([calendars, deletes, confirmations], [1, 1, 2]);
  });
});

test("AI queue includes chat/voice only, excluding Google, app, and unverified appointments", async () => {
  await rollback(async tx => {
    const origins = ["chat_bot", "voice_bot", "google", "app", "unknown"] as const;
    const ids = new Map<string, typeof origins[number]>();
    const rows = [];
    for (const origin of origins) {
      const row = await imported(tx);
      ids.set(row.input.appointmentId, origin);
      rows.push(row);
    }
    const queue = await readAiBookingsReal(tx, async identity => ids.get(identity.appointmentId) ?? "unknown");
    const fixtureIds = new Set(rows.map(row => row.id));
    assert.deepEqual(queue.filter(row => fixtureIds.has(row.id)).map(row => row.botOrigin).sort(), ["chat_bot", "voice_bot"]);
    let effects = 0;
    await assert.rejects(() => convertAiBookingReal(rows[2].id, review(), tx, {
      origin: async () => "google",
      calendar: async () => { effects++; return "bad"; },
      deleteAppointment: async () => { effects++; },
      webhook: async () => { effects++; },
    }), AiConversionError);
    assert.equal(effects, 0);
  });
});

test("GHL origin requires explicit bot metadata; Google overrides a bot intake marker", async () => {
  assert.equal(appointmentOrigin({ createdBy: { source: "Conversation AI" } }), "chat_bot");
  assert.equal(appointmentOrigin({ createdBy: { channel: "voice_ai" } }), "voice_bot");
  assert.equal(appointmentOrigin({ source: "api" }), "unknown");
  assert.equal(appointmentOrigin({ source: "vivid-app" }), "app");
  const identity = { appointmentId: "fixture-event", calendarId: "fixture-calendar", locationId: "fixture-location" };
  assert.equal(await getAppointmentOrigin(identity, "chat_bot", {
    token: "fixture-token", locationId: identity.locationId,
    fetcher: async () => new Response(JSON.stringify({ event: { id: identity.appointmentId, calendarId: identity.calendarId, createdBy: { source: "Google Calendar" } } })),
  }), "google");
  await assert.rejects(() => getAppointmentOrigin(identity, "chat_bot", {
    token: "fixture-token", locationId: identity.locationId,
    fetcher: async () => new Response(JSON.stringify({ event: { id: identity.appointmentId, calendarId: "wrong-calendar", createdBy: { source: "Conversation AI" } } })),
  }), /calendar ID mismatch/);
  assert.equal(await getAppointmentOrigin(identity, "chat_bot", {
    token: "fixture-token", locationId: identity.locationId,
    fetcher: async () => new Response(JSON.stringify({ event: null })),
  }), "unknown");
  assert.equal(await getAppointmentOrigin(identity, null, {
    token: "fixture-token", locationId: identity.locationId,
    fetcher: async () => new Response(JSON.stringify({ appointment: {
      id: identity.appointmentId, calendarId: identity.calendarId, createdBy: { source: "Conversation AI" },
    } })),
  }), "chat_bot");
});

test("GHL deletion uses exact DELETE endpoint/version, never cancellation, and rejects unconfirmed deletes", async () => {
  const identity = { appointmentId: "fixture-event", calendarId: "fixture-calendar", locationId: "fixture-location" };
  let requests = 0;
  await deleteGhlAppointment(identity, {
    token: "fixture-token", locationId: identity.locationId,
    fetcher: async (url, init) => {
      requests++;
      assert.equal(url, "https://services.leadconnectorhq.com/calendars/events/fixture-event");
      assert.equal(init?.method, "DELETE");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Version"), "2021-04-15");
      assert.equal(headers.get("Authorization"), "Bearer fixture-token");
      assert.equal(init?.body, "{}");
      return new Response(JSON.stringify({ succeeded: true }), { status: 201 });
    },
  });
  assert.equal(requests, 1);
  await deleteGhlAppointment(identity, { token: "fixture-token", locationId: identity.locationId,
    fetcher: async () => new Response(null, { status: 404 }) });
  await assert.rejects(() => deleteGhlAppointment(identity, { token: "fixture-token", locationId: identity.locationId,
    fetcher: async () => new Response(JSON.stringify({ succeeded: false }), { status: 201 }) }));
});

test("origin diagnostics expose structure but never customer data or response values", async () => {
  const result = await inspectAppointmentLookup({ appointmentId: "fixture", locationId: "fixture-location", calendarId: "fixture-calendar" }, {
    token: "fixture-token", locationId: "fixture-location",
    fetcher: async () => new Response(JSON.stringify({ appointment: { id: "private-id", contactId: "private-contact" } })),
  });
  assert.deepEqual(result.responseFields, ["appointment", "appointment.id", "appointment.contactId"]);
  assert.equal(result.eventFound, true);
  assert.ok(!JSON.stringify(result).includes("private-contact"));
  assert.ok(!JSON.stringify(result).includes("private-id"));
});

test("Google-origin appointment callbacks are acknowledged without importing another booking", async () => {
  let imported = 0;
  const app = express();
  app.use(express.json());
  app.post("/probe", createGhlSpecialBookingHandler(
    () => ({ locationId: "fixture-location", secret: "fixture-secret" }),
    async () => { imported++; throw new Error("Must not import Google events"); },
    async () => "google", () => true,
  ));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/probe`, { method: "POST", headers: {
      "Content-Type": "application/json", Authorization: "Bearer fixture-secret",
    }, body: JSON.stringify({ locationId: "fixture-location", appointmentId: "fixture-event",
      calendarId: SPECIAL_CALENDARS.detailing, appointmentStatus: "new", bookingOrigin: "chat_bot" }) });
    assert.equal(res.status, 200);
    assert.equal(imported, 0);
    assert.equal((await res.json() as { action: string }).action, "ignored");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});