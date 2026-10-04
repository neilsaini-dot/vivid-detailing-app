import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db, bookingsTable, customersTable, vehiclesTable, bookingItemsTable,
  ghlSpecialAppointmentsTable, aiBookingConversionsTable,
} from "@workspace/db";
import { AdminConvertAiBookingBody } from "@workspace/api-zod";
import { specialForCalendar, SPECIAL_NAMES } from "./ghlSpecialsConfig";
import { repriceSpecialBooking, syncSpecialLoyalty } from "./ghlSpecialIntake";
import { sendGhlConversionConfirmed, GhlConversionDeliveryError, type GhlBookingConfirmedPayload } from "./ghl";
import { createCalendarEvent, type CalendarEventInput } from "./googleCalendar";
import { getAppointmentOrigin, deleteGhlAppointment, type BotOrigin, type AppointmentOrigin, type GhlAppointmentIdentity } from "./ghlAppointments";

type Database = Pick<typeof db, "transaction">;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Review = ReturnType<typeof AdminConvertAiBookingBody.parse>;
export class AiConversionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function error(status: number, message: string): never { throw new AiConversionError(status, message); }

type OriginResolver = (identity: GhlAppointmentIdentity, trustedOrigin?: BotOrigin | null) => Promise<AppointmentOrigin>;
const botOrigin = (value: string | null | undefined): BotOrigin | null =>
  value === "chat_bot" || value === "voice_bot" ? value : null;

export async function readAiBookings(database: Pick<typeof db, "select"> = db, originResolver: OriginResolver = getAppointmentOrigin) {
  const rows = await database.select({
    booking: bookingsTable, mapping: ghlSpecialAppointmentsTable,
    customer: customersTable, vehicle: vehiclesTable, conversion: aiBookingConversionsTable,
  }).from(ghlSpecialAppointmentsTable)
    .innerJoin(bookingsTable, eq(ghlSpecialAppointmentsTable.bookingId, bookingsTable.id))
    .leftJoin(customersTable, eq(bookingsTable.customerId, customersTable.id))
    .leftJoin(vehiclesTable, eq(bookingsTable.vehicleId, vehiclesTable.id))
    .leftJoin(aiBookingConversionsTable, eq(bookingsTable.id, aiBookingConversionsTable.bookingId));
  const result = [];
  // Bound API concurrency instead of issuing one burst per admin poll.
  for (let index = 0; index < rows.length; index += 4) {
  const batch = await Promise.all(rows.slice(index, index + 4).map(async ({ booking, mapping, customer, vehicle, conversion }) => {
    const special = specialForCalendar(mapping.calendarId);
    if (!special) return [];
    const recordedOrigin = botOrigin(conversion?.botOrigin);
    const origin = conversion?.state === "converted" || (conversion?.calendarEventId && recordedOrigin)
      ? recordedOrigin : await originResolver(mapping, recordedOrigin);
    if (conversion?.state !== "converted" && origin !== "chat_bot" && origin !== "voice_bot") return [];
    return [{
      id: booking.id, special, ghlAppointmentId: mapping.appointmentId, status: booking.status,
      appointmentAt: booking.appointmentAt?.toISOString() ?? null,
      appointmentEndAt: mapping.appointmentEndAt?.toISOString() ?? null,
      totalEstimate: booking.totalEstimate === null ? null : Number(booking.totalEstimate),
      customer: { name: customer?.name ?? null, email: customer?.email ?? null, phone: customer?.phone ?? null },
      vehicle: { type: vehicle?.type ?? null, year: vehicle?.year ?? null, make: vehicle?.make ?? null,
        model: vehicle?.model ?? null, colour: vehicle?.colour ?? null },
      notes: booking.notes, conversionState: conversion?.state ?? "review",
      webhookState: conversion?.webhookState ?? "pending",
      calendarEventId: conversion?.calendarEventId ?? (conversion?.state === "converted" ? booking.calendarEventId : null),
      convertedAt: conversion?.convertedAt?.toISOString() ?? null, lastError: conversion?.lastError ?? null,
      botOrigin: botOrigin(origin), ghlDeleteState: conversion?.ghlDeleteState ?? "pending",
      ghlDeleteError: conversion?.ghlDeleteError ?? null,
      requiresGhlCleanup: conversion?.ghlDeleteState === "failed"
        || (conversion?.state === "converted" && conversion.ghlDeleteState !== "deleted"),
    }];
  }));
  result.push(...batch.flat());
  }
  return result.sort((a, b) => (b.appointmentAt ?? "").localeCompare(a.appointmentAt ?? ""));
}

export async function rememberAiBotOrigin(id: string, origin: BotOrigin) {
  await db.insert(aiBookingConversionsTable).values({ bookingId: id, botOrigin: origin })
    .onConflictDoNothing({ target: aiBookingConversionsTable.bookingId });
}
function validateReview(body: Review, converting: boolean): Review {
  const clean = {
    customer: { name: body.customer.name.trim(), email: body.customer.email.trim().toLowerCase(), phone: body.customer.phone.trim() },
    vehicle: { ...body.vehicle, make: body.vehicle.make.trim(), model: body.vehicle.model.trim(), colour: body.vehicle.colour.trim() },
    notes: body.notes.trim(),
  };
  if (clean.customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.customer.email)) error(422, "Enter a valid email or leave it blank.");
  const digits = clean.customer.phone.replace(/\D/g, "");
  if (clean.customer.phone && (digits.length < 7 || digits.length > 15)) error(422, "Enter a valid phone number.");
  if (clean.vehicle.year !== null && (!Number.isInteger(clean.vehicle.year) || clean.vehicle.year < 1900 || clean.vehicle.year > new Date().getUTCFullYear() + 2)) {
    error(422, "Vehicle year must be a valid four-digit year or blank.");
  }
  if (Object.values(clean.customer).concat(clean.vehicle.make, clean.vehicle.model, clean.vehicle.colour)
    .some(value => /\{\{[^{}]*\}\}/.test(value))) error(422, "Replace unresolved merge tags with the actual details or leave optional fields blank.");
  if (converting && (!clean.customer.name || !clean.customer.phone)) error(422, "Customer name and phone are required before conversion.");
  return clean;
}

async function lockBooking(tx: Tx, id: string) {
  const [mapping] = await tx.select().from(ghlSpecialAppointmentsTable).where(eq(ghlSpecialAppointmentsTable.bookingId, id));
  if (!mapping) error(404, "AI booking not found.");
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([mapping.locationId, mapping.appointmentId])}, 0))`);
  const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, id)).for("update");
  if (!booking) error(404, "Booking not found.");
  const [conversion] = await tx.select().from(aiBookingConversionsTable).where(eq(aiBookingConversionsTable.bookingId, id));
  return { mapping, booking, conversion };
}

async function saveReview(tx: Tx, id: string, body: Review, converting: boolean) {
  const locked = await lockBooking(tx, id);
  if (locked.conversion?.state === "converted") {
    if (converting) return locked;
    error(409, "This booking is already converted. Edit it in the usual Bookings tab.");
  }
  if (locked.conversion?.state === "processing") error(409, "Conversion is already in progress. Refresh to check its result.");
  if (!["pending", "confirmed"].includes(locked.booking.status)) error(409, "Cancelled or started jobs cannot be converted.");
  if (["sending", "uncertain"].includes(locked.conversion?.webhookState ?? "")) {
    error(409, "Check GHL automation history and verify webhook delivery before trying conversion again.");
  }
  const clean = validateReview(body, converting);
  if (!locked.booking.customerId || !locked.booking.vehicleId) error(409, "This booking needs a linked customer and vehicle.");
  const [customer] = await tx.select().from(customersTable).where(eq(customersTable.id, locked.booking.customerId)).for("update");
  const [vehicle] = await tx.select().from(vehiclesTable).where(eq(vehiclesTable.id, locked.booking.vehicleId)).for("update");
  if (!customer || !vehicle) error(409, "The linked customer or vehicle no longer exists.");
  if (locked.conversion?.webhookState === "sent" || locked.conversion?.calendarEventId) {
    const current = { customer: { name: customer.name ?? "", email: customer.email ?? "", phone: customer.phone ?? "" },
      vehicle: { type: vehicle.type, year: vehicle.year, make: vehicle.make ?? "", model: vehicle.model ?? "", colour: vehicle.colour ?? "" },
      notes: locked.booking.notes ?? "" };
    if (JSON.stringify(clean) !== JSON.stringify(current)) error(409, "Conversion has already started. Resume its unfinished steps without changing details.");
    return locked;
  }
  await tx.update(customersTable).set({
    name: clean.customer.name || null, email: clean.customer.email || null, phone: clean.customer.phone || null,
  }).where(eq(customersTable.id, customer.id));
  await tx.update(vehiclesTable).set({
    ...clean.vehicle, make: clean.vehicle.make || null, model: clean.vehicle.model || null, colour: clean.vehicle.colour || null,
  }).where(eq(vehiclesTable.id, vehicle.id));
  const special = specialForCalendar(locked.mapping.calendarId)!;
  const priced = vehicle.type !== clean.vehicle.type || locked.booking.totalEstimate === null
    ? await repriceSpecialBooking(tx, locked.booking, special, clean.vehicle.type) : locked.booking;
  const [saved] = await tx.update(bookingsTable).set({
    totalEstimate: priced.totalEstimate, notes: clean.notes || null,
    createdByAdmin: true,
  }).where(eq(bookingsTable.id, id)).returning();
  await syncSpecialLoyalty(tx, saved);
  return { ...locked, booking: saved };
}

export async function saveAiBooking(id: string, body: Review, database: Database = db) {
  await database.transaction(tx => saveReview(tx, id, body, false));
}

export async function resolveAiWebhook(id: string, verifiedInGhl: boolean, delivered: boolean, database: Database = db) {
  if (!verifiedInGhl) error(422, "Check the booking-confirmed automation in GHL before recording its delivery.");
  await database.transaction(async tx => {
    const { conversion } = await lockBooking(tx, id);
    if (!conversion || conversion.state === "converted") error(409, "This booking has no interrupted conversion to verify.");
    if (conversion.state === "processing" && conversion.claimedAt && Date.now() - conversion.claimedAt.getTime() < 120000) {
      error(409, "Conversion is still running. Wait two minutes before verifying an interrupted delivery.");
    }
    if (!["sending", "uncertain"].includes(conversion.webhookState) && conversion.state !== "processing") {
      error(409, "Webhook delivery does not need verification.");
    }
    await tx.update(aiBookingConversionsTable).set({
      state: "failed", webhookState: delivered ? "sent" : "pending",
      lastError: delivered ? "Staff verified the webhook was delivered. Resume the unfinished conversion steps without resending confirmation."
        : "Staff verified the webhook was not delivered. Conversion can be retried.",
    }).where(eq(aiBookingConversionsTable.bookingId, id));
  });
}

export function aiCalendarEventId(id: string) {
  return `ai${createHash("sha256").update(`vivid-ai-conversion:${id}`).digest("hex")}`;
}

type Effects = {
  webhook: (payload: GhlBookingConfirmedPayload, key: string) => Promise<void>;
  calendar: (input: CalendarEventInput) => Promise<string | null>;
  origin: OriginResolver;
  deleteAppointment: (identity: GhlAppointmentIdentity) => Promise<void>;
};
const defaultEffects: Effects = { webhook: sendGhlConversionConfirmed, calendar: createCalendarEvent,
  origin: getAppointmentOrigin, deleteAppointment: deleteGhlAppointment };

export async function convertAiBooking(id: string, body: Review, database: Database = db, effects: Effects = defaultEffects) {
  const prepared = await database.transaction(async tx => {
    const { booking, mapping, conversion } = await saveReview(tx, id, body, true);
    if (conversion?.state === "converted") return null;
    const verifiedOrigin = conversion?.calendarEventId && botOrigin(conversion.botOrigin)
      ? botOrigin(conversion.botOrigin) : await effects.origin(mapping, botOrigin(conversion?.botOrigin));
    if (verifiedOrigin !== "chat_bot" && verifiedOrigin !== "voice_bot") {
      error(422, "Only verified chat/voice-bot appointments can be converted. Do not convert app or Google-origin appointments.");
    }
    if (!booking.appointmentAt || !mapping.appointmentEndAt || mapping.appointmentEndAt <= booking.appointmentAt) {
      error(422, "A valid appointment start and end are required. Correct the appointment in GHL first.");
    }
    if (booking.totalEstimate === null) error(422, "Complete special pricing before conversion.");
    const [customer] = await tx.select().from(customersTable).where(eq(customersTable.id, booking.customerId!));
    const [vehicle] = await tx.select().from(vehiclesTable).where(eq(vehiclesTable.id, booking.vehicleId!));
    const items = await tx.select().from(bookingItemsTable).where(eq(bookingItemsTable.bookingId, id));
    const services = items.filter(item => item.itemType === "service").map(item => item.itemName);
    const addons = items.filter(item => item.itemType === "addon").map(item => item.itemName);
    const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.type;
    const total = Number(booking.totalEstimate);
    const description = [
      `Customer: ${customer.name} | ${customer.phone} | ${customer.email ?? ""}`,
      `Vehicle: ${vehicleLabel}`, `Services: ${services.join(", ") || SPECIAL_NAMES[specialForCalendar(mapping.calendarId)!]}`,
      addons.length ? `Add-ons: ${addons.join(", ")}` : null,
      `Estimated Total (incl. HST): $${total.toFixed(2)}`, booking.notes ? `Notes: ${booking.notes}` : null,
      `Booking ID: ${id}`, `GoHighLevel appointment: ${mapping.appointmentId}`,
    ].filter(Boolean).join("\n");
    const [firstName, ...rest] = customer.name!.split(" ");
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Halifax", month: "long", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
    }).formatToParts(booking.appointmentAt);
    const part = (name: string) => parts.find(p => p.type === name)?.value ?? "";
    const appointment = `${part("month")} ${part("day")}, ${part("year")} at ${part("hour")}:${part("minute")}${part("dayPeriod").toLowerCase()}`;
    const payload = {
      event: "booking_confirmed" as const, booking_confirmed: true as const,
      contact: { firstName, lastName: rest.join(" "), email: customer.email ?? "", phone: customer.phone ?? "",
        tags: ["Booking", "Vivid Detailing", ...services], ghlContactId: mapping.externalContactId },
      opportunity: { title: `${services[0] ?? "Detailing"} - ${vehicleLabel}`, status: "won" as const,
        monetaryValue: total, pipelineStageName: "Won" as const, notes: description },
      booking: { id, services, addons, vehicle: vehicleLabel, appointment_at: appointment,
        total_estimate: total, is_quote_based: items.some(item => item.isQuoteBased), notes: booking.notes,
        ghl_appointment_id: mapping.appointmentId, ghl_calendar_id: mapping.calendarId },
      source: "vivid-app" as const, conversion_id: `ai-conversion:${id}`,
    };
    const calendar: CalendarEventInput = {
      id: aiCalendarEventId(id), bookingId: id,
      calendarId: "contact@vividpei.com",
      summary: `Vivid Detailing - ${customer.name} - ${services.join(", ") || "Appointment"}`,
      description, startIso: booking.appointmentAt.toISOString(),
      durationHours: (mapping.appointmentEndAt.getTime() - booking.appointmentAt.getTime()) / 3600000,
    };
    await tx.insert(aiBookingConversionsTable).values({
      bookingId: id, state: "processing", botOrigin: verifiedOrigin,
      webhookState: conversion?.webhookState ?? "pending", claimedAt: new Date(), lastError: null,
    }).onConflictDoUpdate({ target: aiBookingConversionsTable.bookingId,
      set: { state: "processing", botOrigin: verifiedOrigin, claimedAt: new Date(), lastError: null } });
    return { payload, calendar, mapping, webhookSent: conversion?.webhookState === "sent",
      calendarId: conversion?.calendarEventId, deleteState: conversion?.ghlDeleteState ?? "pending" };
  });
  if (!prepared) return;
  const update = async (values: Partial<typeof aiBookingConversionsTable.$inferInsert>) => {
    await database.transaction(async tx => {
      await tx.update(aiBookingConversionsTable).set(values).where(eq(aiBookingConversionsTable.bookingId, id));
    });
  };
  try {
    // 1. Create a NEW app-owned event, not the Google mirror of the GHL event.
    const calendarId = prepared.calendarId ?? await effects.calendar(prepared.calendar);
    if (!calendarId) {
      await update({ state: "failed", lastError: "Google Calendar event could not be confirmed. No GHL deletion or confirmation webhook was attempted." });
      error(502, "Google Calendar failed. The GHL appointment was kept and no confirmation webhook was sent.");
    }
    await database.transaction(async tx => {
      await tx.update(bookingsTable).set({ calendarEventId: calendarId }).where(eq(bookingsTable.id, id));
      await tx.update(aiBookingConversionsTable).set({ calendarEventId: calendarId }).where(eq(aiBookingConversionsTable.bookingId, id));
    });
    // 2. Delete, never cancel. A failed delete is a manual-cleanup warning,
    // not a reason to discard the app booking or suppress its confirmation.
    if (!["deleted", "failed"].includes(prepared.deleteState)) {
      await update({ ghlDeleteState: "deleting", ghlDeleteError: null });
      try {
        await effects.deleteAppointment(prepared.mapping);
        await update({ ghlDeleteState: "deleted", ghlDeleteError: null });
      } catch (cause) {
        await update({ ghlDeleteState: "failed", ghlDeleteError: cause instanceof Error
          ? cause.message : "GHL deletion could not be confirmed. Delete the original appointment manually." });
      }
    }
    // 3. Send the same confirmation as a native booking.
    if (!prepared.webhookSent) {
      await update({ webhookState: "sending" });
      try { await effects.webhook(prepared.payload, `ai-conversion:${id}`); }
      catch (cause) {
        const uncertain = !(cause instanceof GhlConversionDeliveryError) || cause.uncertain;
        await update({ state: "failed", webhookState: uncertain ? "uncertain" : "pending",
          lastError: cause instanceof GhlConversionDeliveryError ? cause.message : "Webhook delivery could not be verified. Check GHL automation history." });
        error(502, uncertain ? "Webhook delivery is unverified. Check GHL automation history before retrying." : "Webhook was not accepted. Fix the integration and retry.");
      }
      await update({ webhookState: "sent" });
    }
    // 4. Final receipt. Repeated conversion requests become a no-op.
    await database.transaction(async tx => {
      await tx.update(bookingsTable).set({ calendarEventId: calendarId }).where(eq(bookingsTable.id, id));
      await tx.update(aiBookingConversionsTable).set({
        state: "converted", calendarEventId: calendarId, convertedAt: new Date(), lastError: null,
      }).where(eq(aiBookingConversionsTable.bookingId, id));
    });
  } catch (cause) {
    if (cause instanceof AiConversionError) throw cause;
    // Fail closed: a receipt write may have failed after the remote accepted it.
    await update({ state: "failed", lastError: "Conversion interrupted. Refresh and verify delivery before retrying." }).catch(() => {});
    error(502, "Conversion interrupted. Completed steps are retained; refresh to check delivery.");
  }
}