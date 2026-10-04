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
  syncSpecialAppointment, parseSpecialDate, normaliseSpecialInput, specialTimestampDiagnostics, SpecialSyncError,
} from "../src/lib/ghlSpecialBookings";
import { createGhlSpecialBookingHandler } from "../src/routes/ghl-specials";
import { finishPendingSpecialPrice, specialVehicleNotes } from "../src/lib/ghlSpecialIntake";

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

test("missing identifiers and invalid provided data still roll back", async () => {
  await rollbackTest(async tx => {
    for (const overrides of [
      { contact: undefined }, { contact: { id: "" } }, { startTime: undefined },
      { vehicle: { type: "car", year: "abc" } },
      { startTime: "2027-01-12 09:00:00" }, { endTime: "2027-01-11T09:00:00Z" },
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

test("incomplete intake defaults to car and later enriches the same booking", async () => {
  await rollbackTest(async tx => {
    const contactId = randomUUID();
    const input = fixture({
      contact: { id: contactId },
      vehicle: { year: "2022", make: "Toyota", model: "Corolla" },
    });
    const created = await syncSpecialAppointment(input, tx);
    assert.equal(created.action, "created");
    assert.equal(created.totalEstimate, 228.85);
    assert.equal((await syncSpecialAppointment(input, tx)).action, "duplicate");
    const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, created.bookingId!));
    assert.ok(booking.vehicleId);
    const [defaultVehicle] = await tx.select().from(vehiclesTable).where(eq(vehiclesTable.id, booking.vehicleId));
    assert.equal(defaultVehicle.type, "car");
    assert.equal(defaultVehicle.model, "Corolla");
    const [customer] = await tx.select().from(customersTable).where(eq(customersTable.id, booking.customerId!));
    assert.equal(customer.name, null);
    assert.equal(customer.email, null);
    assert.equal(customer.phone, null);
    const [item] = await tx.select().from(bookingItemsTable).where(eq(bookingItemsTable.bookingId, booking.id));
    assert.equal(Number(item.unitPrice), 199);
    assert.equal(item.isQuoteBased, false);
    assert.equal((await tx.select().from(loyaltyActivityTable).where(eq(loyaltyActivityTable.bookingId, booking.id))).length, 1);
    const rescheduled = await syncSpecialAppointment({
      ...input, vehicle: undefined, contact: undefined,
      startTime: "2027-01-13T09:00:00-04:00", endTime: "2027-01-13T15:00:00-04:00",
    }, tx);
    assert.equal(rescheduled.bookingId, created.bookingId);
    assert.equal(rescheduled.totalEstimate, 228.85);
    const enriched = await syncSpecialAppointment({
      ...input, vehicle: { type: "suv" },
      contact: { id: contactId, name: "Provided Later", phone: "+19025550123" },
    }, tx);
    assert.equal(enriched.bookingId, created.bookingId);
    assert.equal(enriched.totalEstimate, 251.85);
    const [updated] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, booking.id));
    const [vehicle] = await tx.select().from(vehiclesTable).where(eq(vehiclesTable.id, updated.vehicleId!));
    assert.equal(vehicle.year, 2022);
    assert.equal(vehicle.model, "Corolla");
    assert.doesNotMatch(updated.internalNotes!, /Pending GHL vehicle details/);
    const [enrichedCustomer] = await tx.select().from(customersTable).where(eq(customersTable.id, booking.customerId!));
    assert.equal(enrichedCustomer.name, "Provided Later");
    await syncSpecialAppointment({ ...input, contact: { id: contactId, name: "", email: "", phone: "" }, vehicle: { type: "" } }, tx);
    const [preserved] = await tx.select().from(customersTable).where(eq(customersTable.id, booking.customerId!));
    assert.equal(preserved.name, "Provided Later");
    assert.equal(preserved.phone, "+19025550123");
    assert.equal((await tx.select().from(loyaltyActivityTable).where(eq(loyaltyActivityTable.bookingId, booking.id))).length, 1);
    const blankUpdate = SyncGhlSpecialBookingBody.parse(normaliseSpecialInput({
      ...input, contact: { id: contactId, name: null, email: null, phone: null }, vehicle: null, notes: "",
    }));
    assert.equal(blankUpdate.notes, undefined);
    assert.equal((await syncSpecialAppointment(blankUpdate, tx)).totalEstimate, 251.85);
    const [stillSuv] = await tx.select().from(vehiclesTable).where(eq(vehiclesTable.id, updated.vehicleId!));
    assert.equal(stillSuv.type, "suv");
  });
});

test("missing or blank vehicle types default to car with special pricing", async () => {
  await rollbackTest(async tx => {
    for (const vehicle of [undefined, null, {}, { type: null }, { type: "" }, { type: " \t " }]) {
      const input = SyncGhlSpecialBookingBody.parse(normaliseSpecialInput({
        ...fixture(), vehicle, contact: { id: randomUUID() },
      }));
      const ceramic = await syncSpecialAppointment({ ...input, calendarId: SPECIAL_CALENDARS.ceramic }, tx);
      assert.equal(ceramic.totalEstimate, 1144.25);
      const detailing = await syncSpecialAppointment({ ...input, appointmentId: randomUUID() }, tx);
      assert.equal(detailing.totalEstimate, 228.85);
      for (const result of [ceramic, detailing]) {
        const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, result.bookingId!));
        const [stored] = await tx.select().from(vehiclesTable).where(eq(vehiclesTable.id, booking.vehicleId!));
        assert.equal(stored.type, "car");
      }
    }
    const normalized = SyncGhlSpecialBookingBody.parse(normaliseSpecialInput({
      ...fixture(), contact: { id: randomUUID(), name: null, email: null, phone: null },
      vehicle: { type: null, year: null, make: null, model: null, colour: null },
    }));
    const created = await syncSpecialAppointment(normalized, tx);
    assert.equal(created.action, "created");
    const cancelled = await syncSpecialAppointment({
      locationId: normalized.locationId, appointmentId: normalized.appointmentId,
      calendarId: normalized.calendarId, appointmentStatus: "cancelled",
    }, tx);
    assert.equal(cancelled.bookingId, created.bookingId);
    assert.equal(cancelled.status, "cancelled");
    assert.equal((await syncSpecialAppointment(normalized, tx)).action, "ignored");
  });
});

test("blank updates and matching appointments preserve known non-car vehicle types", async () => {
  await rollbackTest(async tx => {
    for (const type of ["suv", "truck", "van"] as const) {
      const input = fixture({ vehicle: { type, year: "2020", make: "Test", model: "Fixture" } });
      const created = await syncSpecialAppointment(input, tx);
      for (const vehicle of [undefined, null, {}, { type: null }, { type: "" }, { type: " \t " }]) {
        const blank = SyncGhlSpecialBookingBody.parse(normaliseSpecialInput({ ...input, vehicle }));
        assert.equal((await syncSpecialAppointment(blank, tx)).totalEstimate, created.totalEstimate);
      }
      const another = await syncSpecialAppointment({
        ...input, appointmentId: randomUUID(),
        vehicle: { year: "2020", make: "Test", model: "Fixture" },
      }, tx);
      assert.equal(another.totalEstimate, created.totalEstimate);
      const [first] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, created.bookingId!));
      const [second] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, another.bookingId!));
      assert.equal(first.vehicleId, second.vehicleId);
      const [stored] = await tx.select().from(vehiclesTable).where(eq(vehiclesTable.id, first.vehicleId!));
      assert.equal(stored.type, type);
    }
  });
});

test("legacy pending imports acquire the car default on a later update", async () => {
  await rollbackTest(async tx => {
    const input = fixture({ vehicle: { year: "2022", make: "Toyota", model: "Corolla" } });
    const created = await syncSpecialAppointment(input, tx);
    const [original] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, created.bookingId!));
    await tx.update(bookingsTable).set({
      vehicleId: null, totalEstimate: null,
      internalNotes: specialVehicleNotes(original.internalNotes, { year: 2022, make: "Toyota", model: "Corolla" }),
    }).where(eq(bookingsTable.id, original.id));
    await tx.update(bookingItemsTable).set({ unitPrice: null, isQuoteBased: true })
      .where(eq(bookingItemsTable.bookingId, original.id));
    await tx.delete(loyaltyActivityTable).where(eq(loyaltyActivityTable.bookingId, original.id));
    await tx.delete(vehiclesTable).where(eq(vehiclesTable.id, original.vehicleId!));
    const updated = await syncSpecialAppointment({ ...input, vehicle: undefined, appointmentStatus: "confirmed" }, tx);
    assert.equal(updated.bookingId, created.bookingId);
    assert.equal(updated.totalEstimate, 228.85);
    const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, original.id));
    const [vehicle] = await tx.select().from(vehiclesTable).where(eq(vehiclesTable.id, booking.vehicleId!));
    assert.equal(vehicle.type, "car");
    assert.equal(vehicle.model, "Corolla");
    assert.doesNotMatch(booking.internalNotes!, /Pending GHL vehicle details/);
    assert.equal((await tx.select().from(loyaltyActivityTable).where(eq(loyaltyActivityTable.bookingId, original.id))).length, 1);
  });
});

test("staff vehicle completion resolves pending price while preserving extras and overrides", async () => {
  await rollbackTest(async tx => {
    const created = await syncSpecialAppointment(fixture({ vehicle: undefined }), tx);
    // Simulate a pending booking imported before the owner's car-default change.
    const [original] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, created.bookingId!));
    await tx.update(bookingsTable).set({ vehicleId: null, totalEstimate: null })
      .where(eq(bookingsTable.id, original.id));
    await tx.update(bookingItemsTable).set({ unitPrice: null, isQuoteBased: true })
      .where(eq(bookingItemsTable.bookingId, original.id));
    await tx.delete(loyaltyActivityTable).where(eq(loyaltyActivityTable.bookingId, original.id));
    await tx.delete(vehiclesTable).where(eq(vehiclesTable.id, original.vehicleId!));
    const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, created.bookingId!));
    const [vehicle] = await tx.insert(vehiclesTable).values({ customerId: booking.customerId, type: "truck" }).returning();
    await tx.insert(bookingItemsTable).values({
      bookingId: booking.id, itemType: "addon", itemName: "Keep extra", unitPrice: "10", quantity: 2,
    });
    const [linked] = await tx.update(bookingsTable).set({ vehicleId: vehicle.id }).where(eq(bookingsTable.id, booking.id)).returning();
    await finishPendingSpecialPrice(tx, linked);
    const [priced] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, booking.id));
    assert.equal(Number(priced.totalEstimate), 297.85);
    assert.equal(priced.appointmentAt?.getTime(), booking.appointmentAt?.getTime());
    assert.equal(priced.calendarEventId, null);
    const [overridden] = await tx.update(bookingsTable).set({ totalEstimate: "77.77", isManualPriceOverride: true })
      .where(eq(bookingsTable.id, booking.id)).returning();
    await finishPendingSpecialPrice(tx, overridden);
    const [preserved] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, booking.id));
    assert.equal(Number(preserved.totalEstimate), 77.77);
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

test("timestamp diagnostics expose dates and known GHL tags but redact unrelated input", () => {
  for (const raw of ["2026-10-10 09:00:00", "10/10/2026 09:00 AM", '"2026-10-10T09:00:00-03:00"', "{{appointment.start_time}}", "Friday, October 4, 2026 9:00 AM"]) {
    assert.equal(specialTimestampDiagnostics(raw).rawValue, raw);
  }
  for (const raw of ["private-customer-value", "secret-value", { token: "private-token" }, 123456]) {
    const diagnostic = specialTimestampDiagnostics(raw);
    assert.equal(diagnostic.rawValue, "[redacted non-date value]");
    assert.doesNotMatch(JSON.stringify(diagnostic), /private|secret|token/);
  }
  assert.equal(specialTimestampDiagnostics(null).rawType, "null");
  assert.equal(specialTimestampDiagnostics(undefined).rawType, "undefined");
  assert.equal(specialTimestampDiagnostics(" 2026-10-10 09:00:00 ").rawLength, 21);
  assert.equal(specialTimestampDiagnostics(" 2026-10-10 09:00:00 ").trimmedLength, 19);
  assert.equal(specialTimestampDiagnostics("{{appointment.start_time}}").unresolvedMergeTag, true);
});

test("timezone handling and normalized input", () => {
  assert.equal(parseSpecialDate("2027-07-12T09:00:00-03:00", "startTime")?.toISOString(), "2027-07-12T12:00:00.000Z");
  assert.equal(parseSpecialDate("2027-01-12T09:00:00-04:00", "startTime")?.toISOString(), "2027-01-12T13:00:00.000Z");
  assert.equal(SyncGhlSpecialBookingBody.parse(normaliseSpecialInput({
    ...fixture(), appointmentStatus: "Confirmed", vehicle: { type: "SUV" },
  })).vehicle?.type, "suv");
});

test("offset-free GHL timestamps use Atlantic time in summer and winter", () => {
  for (const [input, expected] of [
    ["2026-10-10T09:00:00", "2026-10-10T12:00:00.000Z"],
    ["2027-01-12T09:00:00", "2027-01-12T13:00:00.000Z"],
    ["2027-07-12T09:00:00.123", "2027-07-12T12:00:00.123Z"],
    ["2027-03-14T01:30:00", "2027-03-14T05:30:00.000Z"],
    ["2027-03-14T03:30:00", "2027-03-14T06:30:00.000Z"],
    ["2027-11-07T00:30:00", "2027-11-07T03:30:00.000Z"],
    ["2027-11-07T02:30:00", "2027-11-07T06:30:00.000Z"],
    ["2027-11-07T01:30:00-03:00", "2027-11-07T04:30:00.000Z"],
    ["2027-11-07T01:30:00-04:00", "2027-11-07T05:30:00.000Z"],
    ["2027-07-12T09:00:00Z", "2027-07-12T09:00:00.000Z"],
  ]) {
    assert.equal(parseSpecialDate(input, "startTime")?.toISOString(), expected);
  }
  for (const input of [
    "2027-03-14T02:30:00", "2027-11-07T01:30:00",
    "2027-02-30T09:00:00", "2027-01-12T24:00:00", "2027-01-12T09:60:00",
  ]) {
    assert.throws(() => parseSpecialDate(input, "startTime"), SpecialSyncError);
  }
});

test("GHL English month/day AM-PM timestamps use Atlantic time", () => {
  for (const [input, expected] of [
    ["Friday, October 4, 2026 9:00 AM", "2026-10-04T12:00:00.000Z"],
    ["Tuesday, January 12, 2027 9:00 AM", "2027-01-12T13:00:00.000Z"],
    ["July 12, 2027 3:00 PM", "2027-07-12T18:00:00.000Z"],
    ["July 12, 2027 12:00 AM", "2027-07-12T03:00:00.000Z"],
    ["July 12, 2027 12:00 PM", "2027-07-12T15:00:00.000Z"],
    [" january 12, 2027 9:00:30 am ", "2027-01-12T13:00:30.000Z"],
  ]) {
    for (const field of ["startTime", "endTime"]) {
      assert.equal(parseSpecialDate(input, field)?.toISOString(), expected);
    }
  }
  for (const input of [
    "February 30, 2027 9:00 AM", "October 4, 2026 0:00 AM",
    "October 4, 2026 13:00 PM", "October 4, 2026 9:60 AM",
    "March 14, 2027 2:30 AM", "November 7, 2027 1:30 AM",
  ]) {
    assert.throws(() => parseSpecialDate(input, "startTime"), SpecialSyncError);
  }
});

test("missing appointment status defaults to new without replacing explicit statuses", () => {
  for (const appointmentStatus of [undefined, null, "", " \t\n "]) {
    const input = SyncGhlSpecialBookingBody.parse(normaliseSpecialInput({
      ...fixture(), appointmentStatus,
    }));
    assert.equal(input.appointmentStatus, "new");
  }
  for (const appointmentStatus of ["new", "confirmed", "cancelled", "canceled"]) {
    const input = SyncGhlSpecialBookingBody.parse(normaliseSpecialInput({
      ...fixture(), appointmentStatus: ` ${appointmentStatus.toUpperCase()} `,
    }));
    assert.equal(input.appointmentStatus, appointmentStatus);
  }
  for (const appointmentStatus of ["scheduled", "booked", "null", "{{appointment.status}}", 0, false]) {
    assert.equal(SyncGhlSpecialBookingBody.safeParse(normaliseSpecialInput({
      ...fixture(), appointmentStatus,
    })).success, false);
  }
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
      for (const field of ["startTime", "endTime"] as const) {
        const raw = `{{appointment.${field === "startTime" ? "start_time" : "end_time"}}}`;
        const response = await send({ ...fixture(), [field]: raw });
        assert.equal(response.status, 422);
        const warning = warnings.at(-1)!;
        assert.match(String(warning[1]), new RegExp(`${field} must be an ISO 8601 timestamp`));
        assert.match(String(warning[1]), /timestamp diagnostics/);
        const metadata = warning[0] as { timestamps: Record<string, { rawValue: string }> };
        assert.equal(metadata.timestamps[field].rawValue, raw);
        assert.ok(metadata.timestamps.startTime);
        assert.ok(metadata.timestamps.endTime);
      }
      const warningCount = warnings.length;
      assert.equal((await send({ ...fixture(), startTime: privateValue, endTime: secret })).status, 422);
      const protectedWarnings = warnings.slice(warningCount);
      assert.doesNotMatch(JSON.stringify(protectedWarnings), new RegExp(privateValue));
      assert.doesNotMatch(JSON.stringify(protectedWarnings), new RegExp(secret));
      assert.match(JSON.stringify(protectedWarnings), /redacted non-date value/);
      for (const appointmentStatus of [undefined, null, "", " \t "]) {
        const response = await send({ ...fixture(), appointmentStatus });
        assert.equal(response.status, 201);
        const created = await response.json() as { bookingId: string; status: string };
        assert.equal(created.status, "pending");
        const [mapping] = await tx.select().from(ghlSpecialAppointmentsTable)
          .where(eq(ghlSpecialAppointmentsTable.bookingId, created.bookingId));
        assert.equal(mapping.externalStatus, "new");
      }
      assert.equal((await send({ ...fixture(), appointmentStatus: "scheduled" })).status, 422);
      for (const [startTime, endTime, startUtc, endUtc] of [
        ["Friday, October 4, 2026 9:00 AM", "Friday, October 4, 2026 3:00 PM", "2026-10-04T12:00:00.000Z", "2026-10-04T18:00:00.000Z"],
        ["Tuesday, January 12, 2027 9:00 AM", "Tuesday, January 12, 2027 3:00 PM", "2027-01-12T13:00:00.000Z", "2027-01-12T19:00:00.000Z"],
      ]) {
        const input = fixture({ startTime, endTime, eventUpdatedAt: startTime });
        const response = await send(input);
        assert.equal(response.status, 201);
        const created = await response.json() as { bookingId: string };
        const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, created.bookingId));
        assert.equal(booking.appointmentAt?.toISOString(), startUtc);
        const [mapping] = await tx.select().from(ghlSpecialAppointmentsTable)
          .where(eq(ghlSpecialAppointmentsTable.bookingId, created.bookingId));
        assert.equal(mapping.appointmentEndAt?.toISOString(), endUtc);
        assert.equal(mapping.externalUpdatedAt?.toISOString(), startUtc);
        assert.equal((await send({ ...input, startTime: startUtc, endTime: endUtc, eventUpdatedAt: startUtc })).status, 200);
        const [same] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, created.bookingId));
        assert.equal(same.appointmentAt?.toISOString(), startUtc);
      }
      for (const [day, hourUtc] of [["2027-07-12", 12], ["2027-01-12", 13]] as const) {
        const input = fixture({
          startTime: `${day}T09:00:00`, endTime: `${day}T15:00:00`,
          eventUpdatedAt: `${day}T08:00:00`,
        });
        const response = await send(input);
        assert.equal(response.status, 201);
        const created = await response.json() as { bookingId: string };
        const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, created.bookingId));
        assert.equal(booking.appointmentAt?.toISOString(), `${day}T${hourUtc}:00:00.000Z`);
        const [mapping] = await tx.select().from(ghlSpecialAppointmentsTable)
          .where(eq(ghlSpecialAppointmentsTable.bookingId, created.bookingId));
        assert.equal(mapping.appointmentEndAt?.toISOString(), `${day}T${hourUtc + 6}:00:00.000Z`);
        assert.equal(mapping.externalUpdatedAt?.toISOString(), `${day}T${hourUtc - 1}:00:00.000Z`);
        assert.equal((await send({
          ...input, startTime: `${day}T${hourUtc}:00:00Z`,
          endTime: `${day}T${hourUtc + 6}:00:00Z`, eventUpdatedAt: `${day}T${hourUtc - 1}:00:00Z`,
        })).status, 200);
        const mappings = await tx.select().from(ghlSpecialAppointmentsTable).where(and(
          eq(ghlSpecialAppointmentsTable.locationId, input.locationId),
          eq(ghlSpecialAppointmentsTable.appointmentId, input.appointmentId),
        ));
        assert.equal(mappings.length, 1);
      }
      assert.equal((await send(fixture({ vehicle: undefined, contact: { id: randomUUID() } }))).status, 201);
      assert.equal((await send({ ...fixture(), contact: { id: randomUUID(), name: null, email: null, phone: null }, vehicle: null })).status, 201);
      assert.equal((await send(fixture({ contact: { id: "" } }))).status, 422);
      assert.match(JSON.stringify(warnings), /requires contact.id/);
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