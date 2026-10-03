import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq } from "drizzle-orm";
import {
  db, pool, bookingsTable, bookingItemsTable, customersTable, vehiclesTable,
  serviceHistoryTable, loyaltyActivityTable, ghlSpecialAppointmentsTable,
} from "@workspace/db";
import { SyncGhlSpecialBookingBody } from "@workspace/api-zod";
import {
  SPECIAL_CALENDARS, specialPriceCents, validSpecialsToken, type SpecialVehicleType,
} from "../src/lib/ghlSpecialsConfig";
import {
  syncSpecialAppointment, parseSpecialDate, normaliseSpecialInput, SpecialSyncError,
} from "../src/lib/ghlSpecialBookings";
import { createGhlSpecialBookingHandler } from "../src/routes/ghl-specials";

after(async () => { await pool.end(); });

const fixture = (overrides: Record<string, unknown> = {}) => SyncGhlSpecialBookingBody.parse({
  source: "gohighlevel", locationId: "test-location",
  appointmentId: randomUUID(), calendarId: SPECIAL_CALENDARS.detailing,
  appointmentStatus: "new",
  startTime: "2027-01-12T09:00:00-04:00", endTime: "2027-01-12T15:00:00-04:00",
  contact: { id: randomUUID(), name: "Synthetic Integration Test", email: `${randomUUID()}@example.invalid` },
  vehicle: { type: "car", year: "2020", make: "Test", model: "Fixture" },
  ...overrides,
});

// Each database test runs entirely in a transaction which is rolled back.
// No customers, bookings, messages, or appointments survive these tests.
async function rollbackTest(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>) {
  const rollback = new Error("intentional_test_rollback");
  try {
    await db.transaction(async tx => { await fn(tx); throw rollback; });
    assert.fail("Transaction did not roll back.");
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

test("all eight special/vehicle prices and tax-inclusive totals", async () => {
  await rollbackTest(async tx => {
    for (const [type, detailing] of Object.entries({ car: 199, suv: 219, truck: 239, van: 269 })) {
      for (const [calendar, amount] of [[SPECIAL_CALENDARS.detailing, detailing], [SPECIAL_CALENDARS.ceramic, 995]] as const) {
        const input = fixture({ calendarId: calendar, vehicle: { type } });
        const result = await syncSpecialAppointment(input, tx);
        assert.equal(result.action, "created");
        assert.equal(result.totalEstimate, Number((amount * 1.15).toFixed(2)));
        const [item] = await tx.select().from(bookingItemsTable).where(eq(bookingItemsTable.bookingId, result.bookingId!));
        assert.equal(Number(item.unitPrice), amount);
        assert.equal(item.isQuoteBased, false);
        assert.equal(specialPriceCents(result.special, type as SpecialVehicleType), amount * 100);
      }
    }
  });
});

test("duplicate, confirmation, reschedule, and cancellation reuse one booking", async () => {
  await rollbackTest(async tx => {
    const input = fixture();
    const created = await syncSpecialAppointment(input, tx);
    assert.equal((await syncSpecialAppointment(input, tx)).action, "duplicate");
    const confirmed = await syncSpecialAppointment({ ...input, appointmentStatus: "confirmed" }, tx);
    assert.equal(confirmed.bookingId, created.bookingId);
    assert.equal(confirmed.status, "confirmed");
    // A late New does not demote a confirmed booking.
    assert.equal((await syncSpecialAppointment(input, tx)).status, "confirmed");
    const moved = await syncSpecialAppointment({
      ...input, appointmentStatus: "confirmed",
      startTime: "2027-01-13T09:00:00-04:00", endTime: "2027-01-13T15:00:00-04:00",
    }, tx);
    assert.equal(moved.bookingId, created.bookingId);
    const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, created.bookingId!));
    assert.equal(booking.appointmentAt?.toISOString(), "2027-01-13T13:00:00.000Z");
    assert.equal(booking.calendarEventId, null);
    const history = await tx.select().from(serviceHistoryTable).where(eq(serviceHistoryTable.bookingId, booking.id));
    assert.equal(history.length, 1);
    assert.equal((await tx.select().from(loyaltyActivityTable).where(eq(loyaltyActivityTable.bookingId, booking.id))).length, 1);
    const cancelled = await syncSpecialAppointment({
      locationId: input.locationId, calendarId: input.calendarId,
      appointmentId: input.appointmentId, appointmentStatus: "canceled",
    }, tx);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.bookingId, created.bookingId);
    assert.equal((await tx.select().from(loyaltyActivityTable).where(eq(loyaltyActivityTable.bookingId, booking.id))).length, 0);
    assert.equal((await syncSpecialAppointment(input, tx)).action, "ignored");
  });
});

test("cancel-before-create tombstones and stale events prevent resurrection", async () => {
  await rollbackTest(async tx => {
    const input = fixture({ eventUpdatedAt: "2027-01-01T00:00:00Z" });
    const cancelled = await syncSpecialAppointment({
      locationId: input.locationId, calendarId: input.calendarId,
      appointmentId: input.appointmentId, appointmentStatus: "cancelled",
      eventUpdatedAt: "2027-01-02T00:00:00Z",
    }, tx);
    assert.equal(cancelled.bookingId, null);
    assert.equal((await syncSpecialAppointment(input, tx)).reason, "stale_event");
    assert.equal((await syncSpecialAppointment({ ...input, eventUpdatedAt: undefined }, tx)).action, "ignored");
    const reopened = await syncSpecialAppointment({ ...input, eventUpdatedAt: "2027-01-03T00:00:00Z" }, tx);
    assert.equal(reopened.action, "created");
    await syncSpecialAppointment({
      locationId: input.locationId, calendarId: input.calendarId,
      appointmentId: input.appointmentId, appointmentStatus: "cancelled",
    }, tx);
    assert.equal((await syncSpecialAppointment({
      ...input, eventUpdatedAt: "2027-01-04T00:00:00Z",
    }, tx)).action, "ignored");
  });
});

test("missing vehicle and invalid date requests roll back without a customer", async () => {
  await rollbackTest(async tx => {
    for (const overrides of [
      { vehicle: undefined }, { contact: undefined }, { startTime: undefined },
      { vehicle: { type: "" } }, { vehicle: { type: "car", year: "abc" } },
      { startTime: "2027-01-12T09:00:00" }, { endTime: "2027-01-11T09:00:00Z" },
      { startTime: "2027-02-30T09:00:00Z" },
    ]) {
      const input = fixture(overrides);
      await assert.rejects(() => syncSpecialAppointment(input, tx), e => e instanceof SpecialSyncError && e.status === 422);
      if (input.contact?.id) {
        assert.equal((await tx.select().from(customersTable).where(eq(customersTable.ghlContactId, input.contact.id))).length, 0);
      }
    }
  });
});

test("vehicle repricing preserves extras and staff overrides", async () => {
  await rollbackTest(async tx => {
    const input = fixture();
    const created = await syncSpecialAppointment(input, tx);
    await tx.insert(bookingItemsTable).values({
      bookingId: created.bookingId!, itemType: "addon", itemName: "Test extra", unitPrice: "10", quantity: 1,
    });
    const updated = await syncSpecialAppointment({ ...input, vehicle: { type: "van" } }, tx);
    assert.equal(updated.totalEstimate, 320.85);
    const items = await tx.select().from(bookingItemsTable).where(eq(bookingItemsTable.bookingId, created.bookingId!));
    assert.equal(items.length, 2);
    await tx.update(bookingsTable).set({ totalEstimate: "77.77", isManualPriceOverride: true })
      .where(eq(bookingsTable.id, created.bookingId!));
    assert.equal((await syncSpecialAppointment({ ...input, vehicle: { type: "truck" } }, tx)).totalEstimate, 77.77);
  });
});

test("customer matching and multiple appointments stay distinct", async () => {
  await rollbackTest(async tx => {
    const input = fixture();
    const first = await syncSpecialAppointment(input, tx);
    const second = await syncSpecialAppointment({ ...input, appointmentId: randomUUID() }, tx);
    assert.notEqual(first.bookingId, second.bookingId);
    const customers = await tx.select().from(customersTable).where(eq(customersTable.ghlContactId, input.contact!.id!));
    assert.equal(customers.length, 1);
    const jobs = await tx.select().from(bookingsTable).where(eq(bookingsTable.customerId, customers[0].id));
    assert.equal(jobs.length, 2);
    assert.equal((await tx.select().from(vehiclesTable).where(eq(vehiclesTable.customerId, customers[0].id))).length, 1);
    await assert.rejects(() => syncSpecialAppointment({
      ...input, contact: { ...input.contact, id: "different-contact" },
    }, tx), e => e instanceof SpecialSyncError && e.status === 409);
    await assert.rejects(() => syncSpecialAppointment({
      ...input, calendarId: SPECIAL_CALENDARS.ceramic,
    }, tx), e => e instanceof SpecialSyncError && e.status === 409);
  });
});

test("in-progress/completed jobs and existing notes survive status-only deliveries", async () => {
  await rollbackTest(async tx => {
    const input = fixture({ notes: "Original condition note" });
    const created = await syncSpecialAppointment(input, tx);
    const statusOnly = {
      locationId: input.locationId, appointmentId: input.appointmentId,
      calendarId: input.calendarId, appointmentStatus: "confirmed" as const,
    };
    await syncSpecialAppointment(statusOnly, tx);
    let [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, created.bookingId!));
    assert.equal(booking.notes, "Original condition note");
    await tx.update(bookingsTable).set({ status: "in_progress" }).where(eq(bookingsTable.id, booking.id));
    assert.equal((await syncSpecialAppointment({ ...statusOnly, appointmentStatus: "new" }, tx)).status, "in_progress");
    await tx.update(bookingsTable).set({ status: "completed" }).where(eq(bookingsTable.id, booking.id));
    await assert.rejects(() => syncSpecialAppointment({
      ...statusOnly, appointmentStatus: "cancelled",
    }, tx), e => e instanceof SpecialSyncError && e.status === 409);
    [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, created.bookingId!));
    assert.equal(booking.status, "completed");
  });
});

test("timezone handling and normalized input", () => {
  assert.equal(parseSpecialDate("2027-07-12T09:00:00-03:00", "startTime")?.toISOString(), "2027-07-12T12:00:00.000Z");
  assert.equal(parseSpecialDate("2027-01-12T09:00:00-04:00", "startTime")?.toISOString(), "2027-01-12T13:00:00.000Z");
  assert.equal(SyncGhlSpecialBookingBody.parse(normaliseSpecialInput({
    ...fixture(), appointmentStatus: "Confirmed", vehicle: { type: "SUV" },
  })).vehicle?.type, "suv");
});

test("simultaneous deliveries commit only one customer, vehicle, and booking", async () => {
  const input = fixture();
  try {
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => syncSpecialAppointment(input)));
    assert.ok(attempts.every(a => a.status === "fulfilled"));
    const results = attempts.map(a => (a as PromiseFulfilledResult<Awaited<ReturnType<typeof syncSpecialAppointment>>>).value);
    assert.equal(results.filter(r => r.action === "created").length, 1);
    assert.equal(new Set(results.map(r => r.bookingId)).size, 1);
    const customers = await db.select().from(customersTable).where(eq(customersTable.ghlContactId, input.contact!.id!));
    assert.equal(customers.length, 1);
    const jobs = await db.select().from(bookingsTable).where(eq(bookingsTable.customerId, customers[0].id));
    assert.equal(jobs.length, 1);
    assert.equal((await db.select().from(vehiclesTable).where(eq(vehiclesTable.customerId, customers[0].id))).length, 1);
  } finally {
    // Only delete synthetic fixtures belonging to this test's randomly generated contact ID.
    await db.transaction(async tx => {
      const customers = await tx.select().from(customersTable).where(eq(customersTable.ghlContactId, input.contact!.id!));
      for (const customer of customers) {
        const jobs = await tx.select().from(bookingsTable).where(eq(bookingsTable.customerId, customer.id));
        for (const job of jobs) {
          await tx.delete(ghlSpecialAppointmentsTable).where(eq(ghlSpecialAppointmentsTable.bookingId, job.id));
          await tx.delete(loyaltyActivityTable).where(eq(loyaltyActivityTable.bookingId, job.id));
          await tx.delete(serviceHistoryTable).where(eq(serviceHistoryTable.bookingId, job.id));
          await tx.delete(bookingItemsTable).where(eq(bookingItemsTable.bookingId, job.id));
          await tx.delete(bookingsTable).where(eq(bookingsTable.id, job.id));
        }
        await tx.delete(vehiclesTable).where(eq(vehiclesTable.customerId, customer.id));
        await tx.delete(customersTable).where(eq(customersTable.id, customer.id));
      }
    });
  }
});

test("HTTP authentication, allowlist, validation, 201/200 responses, and limits", async () => {
  await rollbackTest(async tx => {
    // This token is a synthetic test fixture, not a configured account secret.
    const secret = "test-fixture-token-not-for-production-12345";
    assert.equal(validSpecialsToken(`Bearer ${secret}`, secret), true);
    assert.equal(validSpecialsToken("Bearer incorrect-token", secret), false);
    const app = express();
    app.set("env", "test");
    app.use(express.json({ limit: "64kb" }));
    const warnings: unknown[][] = [];
    app.use((req, _res, next) => {
      req.log = { error: () => {}, warn: (...args: unknown[]) => { warnings.push(args); } } as unknown as typeof req.log;
      next();
    });
    app.post("/receiver", createGhlSpecialBookingHandler(
      () => ({ secret, locationId: "test-location" }),
      input => syncSpecialAppointment(input, tx),
    ));
    app.post("/unconfigured", createGhlSpecialBookingHandler(() => null));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address() as { port: number };
    const send = (body: unknown, token: string | null = secret, path = "/receiver") => fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    try {
      assert.equal((await send(fixture(), null)).status, 401);
      assert.equal((await send(fixture(), "wrong")).status, 401);
      assert.equal((await send(fixture({ locationId: "wrong-location" }))).status, 403);
      assert.equal((await send(fixture({ calendarId: "wrong-calendar" }))).status, 403);
      assert.equal((await send({})).status, 422);
      assert.match(String(warnings.at(-1)?.[1]), /locationId: required; expected string/);
      assert.match(JSON.stringify(warnings), /locationId/);
      assert.match(JSON.stringify(warnings), /invalid_appointment/);
      const privateValue = "private-customer-value";
      assert.equal((await send({ ...fixture(), vehicle: { type: privateValue } })).status, 422);
      assert.match(String(warnings.at(-1)?.[1]), /vehicle.type: expected one of "car", "suv", "truck", "van", ""/);
      assert.doesNotMatch(JSON.stringify(warnings), new RegExp(privateValue));
      assert.doesNotMatch(JSON.stringify(warnings), new RegExp(secret));
      assert.equal((await send(fixture({ vehicle: undefined }))).status, 422);
      assert.match(JSON.stringify(warnings), /A new booking requires vehicle.type/);
      assert.equal((await send(fixture(), secret, "/unconfigured")).status, 503);
      assert.equal((await send({ padding: "x".repeat(70_000) })).status, 413);
      const input = fixture();
      const created = await send({ ...input, totalEstimate: 0, price: 1 });
      assert.equal(created.status, 201);
      const body = await created.json() as { totalEstimate: number };
      assert.equal(body.totalEstimate, 228.85);
      assert.equal((await send(input)).status, 200);
      const mappings = await tx.select().from(ghlSpecialAppointmentsTable).where(and(
        eq(ghlSpecialAppointmentsTable.locationId, input.locationId),
        eq(ghlSpecialAppointmentsTable.appointmentId, input.appointmentId),
      ));
      assert.equal(mappings.length, 1);
      const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, mappings[0].bookingId!));
      const [vehicle] = await tx.select().from(vehiclesTable).where(eq(vehiclesTable.id, booking.vehicleId!));
      assert.equal(vehicle.type, "car");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});