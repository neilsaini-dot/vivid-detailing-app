import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db, bookingsTable, bookingItemsTable, customersTable, vehiclesTable,
  serviceHistoryTable, loyaltyActivityTable, ghlSpecialAppointmentsTable,
} from "@workspace/db";
import { SyncGhlSpecialBookingBody } from "@workspace/api-zod";
import {
  pendingSpecialVehicle, specialVehicleNotes, repriceSpecialBooking, syncSpecialLoyalty,
} from "./ghlSpecialIntake";
import {
  specialForCalendar, specialPriceCents, SPECIAL_NAMES,
  type SpecialKey, type SpecialVehicleType,
} from "./ghlSpecialsConfig";

export class SpecialSyncError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

type Input = ReturnType<typeof SyncGhlSpecialBookingBody.parse>;
type Database = Pick<typeof db, "transaction">;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Booking = typeof bookingsTable.$inferSelect;
type Action = "created" | "updated" | "duplicate" | "cancelled" | "ignored";

function fail(message: string): never {
  throw new SpecialSyncError(422, "invalid_appointment", message);
}

export function normaliseSpecialInput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const body = { ...raw } as Record<string, unknown>;
  if (typeof body.appointmentStatus === "string") {
    body.appointmentStatus = body.appointmentStatus.trim().toLowerCase();
  }
  // An unset GHL merge field means a new appointment. Never replace an
  // explicit status: cancellations and invalid nonblank values must stay visible.
  if (body.appointmentStatus == null || body.appointmentStatus === "") {
    body.appointmentStatus = "new";
  }
  // GHL sends missing merge fields as blank strings or null. Treat optional
  // null intake values as omitted, not as an instruction to erase known data.
  for (const key of ["contact", "vehicle", "startTime", "endTime", "eventUpdatedAt"]) {
    if (body[key] === null) delete body[key];
  }
  if (body.notes === null || (typeof body.notes === "string" && !body.notes.trim())) delete body.notes;
  if (body.contact && typeof body.contact === "object" && !Array.isArray(body.contact)) {
    const contact = { ...body.contact } as Record<string, unknown>;
    for (const key of ["id", "name", "email", "phone"]) {
      if (contact[key] === null) delete contact[key];
      if (typeof contact[key] === "string") contact[key] = contact[key].trim();
    }
    body.contact = contact;
  }
  if (body.vehicle && typeof body.vehicle === "object" && !Array.isArray(body.vehicle)) {
    const vehicle = { ...body.vehicle } as Record<string, unknown>;
    for (const key of ["type", "year", "make", "model", "colour"]) {
      if (vehicle[key] === null) delete vehicle[key];
      if (typeof vehicle[key] === "string") vehicle[key] = vehicle[key].trim();
    }
    if (typeof vehicle.type === "string") vehicle.type = vehicle.type.trim().toLowerCase();
    body.vehicle = vehicle;
  }
  return body;
}

export function parseSpecialDate(value: string | undefined, name: string): Date | undefined {
  if (value === undefined || value === "") return undefined;
  // Reject localized/offset-free timestamps rather than silently using the host timezone.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    fail(`${name} must be an ISO 8601 timestamp with Z or an explicit UTC offset.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) fail(`${name} is not a valid date.`);
  // Reject impossible calendar days which JavaScript would otherwise normalize.
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
    fail(`${name} is not a valid calendar date.`);
  }
  return date;
}

function suppliedYear(input: Input): number | undefined {
  const raw = input.vehicle?.year;
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (!/^\d{4}$/.test(String(raw))) fail("vehicle.year must be a four-digit year or blank.");
  const year = Number(raw);
  if (year < 1900 || year > new Date().getUTCFullYear() + 2) fail("vehicle.year is outside the supported range.");
  return year;
}

function response(action: Action, special: SpecialKey, booking?: Booking, reason?: string) {
  return {
    success: true,
    action,
    bookingId: booking?.id ?? null,
    special,
    status: booking?.status ?? "cancelled",
    totalEstimate: booking?.totalEstimate == null ? null : Number(booking.totalEstimate),
    ...(reason ? { reason } : {}),
  };
}

async function matchCustomer(tx: Transaction, contact: NonNullable<Input["contact"]>) {
  if (!contact.id?.trim()) {
    fail("A new booking requires contact.id to identify the GoHighLevel customer.");
  }
  const email = contact.email?.trim().toLowerCase() || null;
  const phone = contact.phone?.trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("contact.email is invalid.");
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (phone && (digits.length < 7 || digits.length > 15)) fail("contact.phone is invalid.");

  // Locks on all matching identities protect simultaneous distinct appointments
  // for one customer. Sorted acquisition avoids deadlocks.
  const identities = [`ghl-contact:${contact.id}`, ...(email ? [`email:${email}`] : []),
    ...(phone ? [`phone:${digits}`] : [])].sort();
  for (const key of identities) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
  let matches = await tx.select().from(customersTable)
    .where(eq(customersTable.ghlContactId, contact.id)).limit(2);
  if (matches.length === 0 && email) {
    matches = await tx.select().from(customersTable)
      .where(sql`lower(trim(${customersTable.email})) = ${email}`).limit(2);
  }
  if (matches.length === 0 && phone) {
    matches = await tx.select().from(customersTable)
      .where(sql`regexp_replace(${customersTable.phone}, '[^0-9]', '', 'g') = ${digits}`).limit(2);
  }
  if (matches.length > 1 || (matches[0]?.ghlContactId && matches[0].ghlContactId !== contact.id)) {
    throw new SpecialSyncError(409, "customer_conflict", "Customer identity is ambiguous; staff must resolve it before retrying.");
  }
  if (matches[0]) {
    const [customer] = await tx.update(customersTable).set({
      ghlContactId: contact.id,
      // Preserve existing profile data if the workflow omits it.
      ...(contact.name?.trim() ? { name: contact.name.trim() } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
    }).where(eq(customersTable.id, matches[0].id)).returning();
    return customer;
  }
  const [customer] = await tx.insert(customersTable).values({
    name: contact.name?.trim() || null, email, phone, ghlContactId: contact.id,
  }).returning();
  return customer;
}

/**
 * No external API calls here: GHL owns appointments and Google Calendar sync.
 * Everything is atomic; retries cannot produce orphan customers or duplicate jobs.
 */
export async function syncSpecialAppointment(input: Input, database: Database = db) {
  const special = specialForCalendar(input.calendarId);
  if (!special) throw new SpecialSyncError(403, "calendar_not_allowed", "Calendar is not an approved special calendar.");
  const status = input.appointmentStatus === "canceled" ? "cancelled" : input.appointmentStatus;
  const start = parseSpecialDate(input.startTime, "startTime");
  const end = parseSpecialDate(input.endTime, "endTime");
  const externalUpdatedAt = parseSpecialDate(input.eventUpdatedAt, "eventUpdatedAt");
  if (start && end && end <= start) fail("endTime must be later than startTime.");
  const year = suppliedYear(input);
  const fingerprint = createHash("sha256").update(JSON.stringify({
    ...input, appointmentStatus: status,
    startTime: start?.toISOString(), endTime: end?.toISOString(),
    eventUpdatedAt: externalUpdatedAt?.toISOString(),
  })).digest("hex");

  return database.transaction(async (tx) => {
    const identity = JSON.stringify([input.locationId, input.appointmentId]);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
    const where = and(
      eq(ghlSpecialAppointmentsTable.locationId, input.locationId),
      eq(ghlSpecialAppointmentsTable.appointmentId, input.appointmentId),
    );
    const [mapping] = await tx.select().from(ghlSpecialAppointmentsTable).where(where).limit(1);
    const [booking] = mapping?.bookingId
      ? await tx.select().from(bookingsTable).where(eq(bookingsTable.id, mapping.bookingId)).limit(1).for("update")
      : [];
    if (mapping && mapping.calendarId !== input.calendarId) {
      throw new SpecialSyncError(409, "calendar_changed", "An existing appointment cannot move between special calendars; cancel it and create a new appointment.");
    }
    if (mapping?.externalContactId && input.contact?.id && mapping.externalContactId !== input.contact.id) {
      throw new SpecialSyncError(409, "contact_changed", "An existing appointment cannot be assigned to a different contact.");
    }
    if (mapping?.externalUpdatedAt && externalUpdatedAt && externalUpdatedAt < mapping.externalUpdatedAt) {
      return response("ignored", special, booking, "stale_event");
    }
    if (mapping?.fingerprint === fingerprint) return response("duplicate", special, booking);
    // Without a reliably newer source timestamp, a late New/Confirmed delivery
    // must never revive a cancelled booking (including cancellation tombstones).
    if (mapping?.externalStatus === "cancelled" && status !== "cancelled"
      && (!externalUpdatedAt || !mapping.externalUpdatedAt || externalUpdatedAt <= mapping.externalUpdatedAt)) {
      return response("ignored", special, booking, "cancelled_appointment_requires_newer_source_timestamp");
    }
    if (mapping && !booking && mapping.externalStatus !== "cancelled") {
      throw new SpecialSyncError(409, "booking_removed", "The linked app booking was removed; staff must resolve this appointment.");
    }

    const metadata = {
      calendarId: input.calendarId,
      externalContactId: input.contact?.id || mapping?.externalContactId || null,
      externalStatus: status,
      appointmentEndAt: end ?? mapping?.appointmentEndAt ?? null,
      // An undated cancellation must not inherit an older creation timestamp:
      // that would let an old-but-dated New falsely appear newer than cancellation.
      externalUpdatedAt: status === "cancelled" ? externalUpdatedAt ?? null
        : externalUpdatedAt ?? mapping?.externalUpdatedAt ?? null,
      fingerprint,
      receivedAt: new Date(),
    };
    const saveMapping = async (bookingId: string | null) => {
      await tx.insert(ghlSpecialAppointmentsTable).values({
        locationId: input.locationId, appointmentId: input.appointmentId, bookingId, ...metadata,
      }).onConflictDoUpdate({
        target: [ghlSpecialAppointmentsTable.locationId, ghlSpecialAppointmentsTable.appointmentId],
        set: { bookingId, ...metadata },
      });
    };

    if (status === "cancelled") {
      if (booking?.status === "completed") {
        throw new SpecialSyncError(409, "completed_booking", "A completed job cannot be cancelled by an appointment notification.");
      }
      const [cancelled] = booking
        ? await tx.update(bookingsTable).set({ status: "cancelled" })
          .where(eq(bookingsTable.id, booking.id)).returning()
        : [];
      if (booking) await tx.delete(loyaltyActivityTable).where(eq(loyaltyActivityTable.bookingId, booking.id));
      await saveMapping(booking?.id ?? null);
      return response("cancelled", special, cancelled);
    }

    if (booking) {
      // Preserve completed and in-progress job states: appointment status is not job status.
      if (booking.status === "completed" || booking.status === "in_progress") {
        await saveMapping(booking.id);
        return response("ignored", special, booking, "job_already_started");
      }
      if (input.contact) {
        const contactId = input.contact.id || mapping?.externalContactId || booking.ghlContactId;
        if (contactId) await matchCustomer(tx, { ...input.contact, id: contactId });
      }
      const mergedStart = start ?? booking.appointmentAt;
      const mergedEnd = end ?? mapping?.appointmentEndAt;
      if (mergedStart && mergedEnd && mergedEnd <= mergedStart) {
        fail("The appointment end must be later than its start. Send both dates when rescheduling.");
      }
      const [vehicle] = booking.vehicleId
        ? await tx.select().from(vehiclesTable).where(eq(vehiclesTable.id, booking.vehicleId)).limit(1)
        : [];
      if (booking.vehicleId && !vehicle) throw new SpecialSyncError(409, "vehicle_missing", "The linked booking vehicle was removed.");
      const pendingVehicle = {
        ...pendingSpecialVehicle(booking.internalNotes),
        ...(year !== undefined ? { year } : {}),
        ...(input.vehicle?.make?.trim() ? { make: input.vehicle.make.trim() } : {}),
        ...(input.vehicle?.model?.trim() ? { model: input.vehicle.model.trim() } : {}),
        ...(input.vehicle?.colour?.trim() ? { colour: input.vehicle.colour.trim() } : {}),
      };
      const vehicleType = (input.vehicle?.type || vehicle?.type) as SpecialVehicleType | undefined;
      const vehicleUpdates = {
        ...pendingVehicle,
        type: vehicleType!,
      };
      let vehicleId = booking.vehicleId;
      if (vehicle) {
        await tx.update(vehiclesTable).set(vehicleUpdates).where(eq(vehiclesTable.id, vehicle.id));
      } else if (vehicleType) {
        const [createdVehicle] = await tx.insert(vehiclesTable).values({
          customerId: booking.customerId, ...vehicleUpdates,
        }).returning();
        vehicleId = createdVehicle.id;
      }
      const priced = vehicleType && (vehicleType !== vehicle?.type || booking.totalEstimate === null)
        ? await repriceSpecialBooking(tx, booking, special, vehicleType) : booking;
      const [updated] = await tx.update(bookingsTable).set({
        vehicleId,
        internalNotes: specialVehicleNotes(booking.internalNotes, vehicleId ? null : pendingVehicle),
        status: booking.status === "confirmed" && status === "new" ? "confirmed"
          : status === "confirmed" ? "confirmed" : "pending",
        ...(start ? { appointmentAt: start } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        totalEstimate: priced.totalEstimate,
      }).where(eq(bookingsTable.id, booking.id)).returning();
      await syncSpecialLoyalty(tx, updated);
      await saveMapping(booking.id);
      return response("updated", special, updated);
    }

    if (!start || !end) fail("A new active booking requires startTime and endTime with timezone offsets.");
    if (!input.contact) fail("A new booking requires customer contact information.");
    const customer = await matchCustomer(tx, input.contact);
    const make = input.vehicle?.make?.trim() || null;
    const model = input.vehicle?.model?.trim() || null;
    const existingVehicles = input.vehicle?.type && year && make && model
      ? await tx.select().from(vehiclesTable).where(and(
        eq(vehiclesTable.customerId, customer.id), eq(vehiclesTable.year, year),
        sql`lower(trim(${vehiclesTable.make})) = ${make.toLowerCase()}`,
        sql`lower(trim(${vehiclesTable.model})) = ${model.toLowerCase()}`,
      )).limit(2)
      : [];
    if (existingVehicles.length > 1) {
      throw new SpecialSyncError(409, "vehicle_conflict", "Multiple matching vehicles exist for this customer; staff must resolve them before retrying.");
    }
    const vehicleValues = {
      customerId: customer.id, type: input.vehicle?.type as SpecialVehicleType, year: year ?? null,
      make, model,
      ...(input.vehicle?.colour?.trim() ? { colour: input.vehicle.colour.trim() } : {}),
    };
    const [vehicle] = !input.vehicle?.type ? [] : existingVehicles[0]
      ? await tx.update(vehiclesTable).set(vehicleValues)
        .where(eq(vehiclesTable.id, existingVehicles[0].id)).returning()
      : await tx.insert(vehiclesTable).values(vehicleValues).returning();
    const subtotalCents = special === "ceramic_special" ? 99500
      : input.vehicle?.type ? specialPriceCents(special, input.vehicle.type) : null;
    const total = subtotalCents === null ? null
      : ((subtotalCents + Math.round(subtotalCents * 0.15)) / 100).toFixed(2);
    const [created] = await tx.insert(bookingsTable).values({
      customerId: customer.id, vehicleId: vehicle?.id ?? null,
      status: status === "confirmed" ? "confirmed" : "pending", appointmentAt: start,
      totalEstimate: total, ghlContactId: input.contact.id, source: "other",
      notes: input.notes ?? null,
      internalNotes: specialVehicleNotes(
        `Imported from GoHighLevel (${SPECIAL_NAMES[special]}). Manage appointment times and cancellations in GoHighLevel. Slot end: ${end.toISOString()}; this is not a promised pickup time.`,
        vehicle ? null : {
          ...(year !== undefined ? { year } : {}),
          ...(make ? { make } : {}), ...(model ? { model } : {}),
          ...(input.vehicle?.colour?.trim() ? { colour: input.vehicle.colour.trim() } : {}),
        },
      ),
    }).returning();
    await tx.insert(bookingItemsTable).values({
      bookingId: created.id, itemType: "service", itemName: SPECIAL_NAMES[special],
      unitPrice: subtotalCents === null ? null : (subtotalCents / 100).toFixed(2),
      quantity: 1, isQuoteBased: subtotalCents === null,
    });
    await tx.insert(serviceHistoryTable).values({ customerId: customer.id, bookingId: created.id });
    // Keep parity with the existing booking flow's loyalty accounting.
    await syncSpecialLoyalty(tx, created);
    await saveMapping(created.id);
    return response("created", special, created);
  });
}