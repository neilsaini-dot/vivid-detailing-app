import { eq } from "drizzle-orm";
import {
  db, bookingsTable, bookingItemsTable, vehiclesTable, loyaltyActivityTable,
  ghlSpecialAppointmentsTable,
} from "@workspace/db";
import { getLoyaltyTier } from "./pricing";
import { SPECIAL_NAMES, specialForCalendar, specialPriceCents, type SpecialKey, type SpecialVehicleType } from "./ghlSpecialsConfig";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Booking = typeof bookingsTable.$inferSelect;
export type PartialSpecialVehicle = {
  type?: SpecialVehicleType | "";
  year?: number;
  make?: string;
  model?: string;
  colour?: string;
};

const PENDING_PREFIX = "Pending GHL vehicle details: ";

// Keep supplied details with the appointment until a vehicle type is known.
// The existing vehicle table requires a real type; never invent one.
export function pendingSpecialVehicle(notes: string | null): PartialSpecialVehicle {
  const line = notes?.split("\n").find(line => line.startsWith(PENDING_PREFIX));
  if (!line) return {};
  try {
    const data = JSON.parse(line.slice(PENDING_PREFIX.length));
    return {
      ...(Number.isInteger(data.year) ? { year: data.year } : {}),
      ...(typeof data.make === "string" ? { make: data.make } : {}),
      ...(typeof data.model === "string" ? { model: data.model } : {}),
      ...(typeof data.colour === "string" ? { colour: data.colour } : {}),
    };
  } catch {
    return {};
  }
}

export function specialVehicleNotes(notes: string | null, details: PartialSpecialVehicle | null): string | null {
  const existing = (notes ?? "").split("\n").filter(line => !line.startsWith(PENDING_PREFIX)).join("\n").trim();
  const pending = details === null ? "" : `${PENDING_PREFIX}${JSON.stringify(details)}`;
  return [existing, pending].filter(Boolean).join("\n") || null;
}

// Reprice only the original special line item. Staff overrides/replacement
// items and other quote-based extras must remain authoritative.
export async function repriceSpecialBooking(
  tx: Transaction, booking: Booking, special: SpecialKey, type: SpecialVehicleType,
): Promise<Booking> {
  if (booking.isManualPriceOverride || booking.status === "completed" || booking.status === "in_progress") return booking;
  const items = await tx.select().from(bookingItemsTable).where(eq(bookingItemsTable.bookingId, booking.id));
  const base = items.find(item => item.itemType === "service" && item.itemName === SPECIAL_NAMES[special]);
  if (!base) return booking;
  const cents = specialPriceCents(special, type);
  await tx.update(bookingItemsTable).set({
    unitPrice: (cents / 100).toFixed(2), isQuoteBased: false,
  }).where(eq(bookingItemsTable.id, base.id));
  const pending = items.some(item => item.id !== base.id && item.isQuoteBased);
  const subtotal = items.reduce((sum, item) =>
    sum + (item.id === base.id ? cents : Math.round(Number(item.unitPrice ?? 0) * 100)) * item.quantity, 0);
  const total = pending ? null : ((subtotal + Math.round(subtotal * 0.15)) / 100).toFixed(2);
  const [updated] = await tx.update(bookingsTable).set({ totalEstimate: total })
    .where(eq(bookingsTable.id, booking.id)).returning();
  await syncSpecialLoyalty(tx, updated);
  return updated;
}

export async function syncSpecialLoyalty(tx: Transaction, booking: Booking): Promise<void> {
  if (booking.totalEstimate === null || booking.status === "cancelled") {
    await tx.delete(loyaltyActivityTable).where(eq(loyaltyActivityTable.bookingId, booking.id));
    return;
  }
  const [existing] = await tx.select().from(loyaltyActivityTable)
    .where(eq(loyaltyActivityTable.bookingId, booking.id)).limit(1);
  const values = { spendAmount: booking.totalEstimate, tierAtTime: getLoyaltyTier(Number(booking.totalEstimate)) };
  if (existing) {
    await tx.update(loyaltyActivityTable).set(values).where(eq(loyaltyActivityTable.id, existing.id));
  } else if (booking.customerId) {
    await tx.insert(loyaltyActivityTable).values({ customerId: booking.customerId, bookingId: booking.id, ...values });
  }
}

// Used after staff adds/edits a vehicle in the existing admin form.
export async function finishPendingSpecialPrice(tx: Transaction, booking: Booking): Promise<void> {
  if (!booking.vehicleId) return;
  const [mapping] = await tx.select().from(ghlSpecialAppointmentsTable)
    .where(eq(ghlSpecialAppointmentsTable.bookingId, booking.id)).limit(1);
  const special = mapping && specialForCalendar(mapping.calendarId);
  if (!special) return;
  const [vehicle] = await tx.select().from(vehiclesTable).where(eq(vehiclesTable.id, booking.vehicleId)).limit(1);
  if (!vehicle) return;
  await repriceSpecialBooking(tx, booking, special, vehicle.type as SpecialVehicleType);
  await tx.update(bookingsTable).set({ internalNotes: specialVehicleNotes(booking.internalNotes, null) })
    .where(eq(bookingsTable.id, booking.id));
}