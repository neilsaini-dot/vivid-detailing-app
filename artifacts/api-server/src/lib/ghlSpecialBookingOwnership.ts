import { db, ghlSpecialAppointmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSpecialsConfig } from "./ghlSpecialsConfig";

export async function isGhlSpecialBooking(bookingId: string): Promise<boolean> {
  // A disabled optional importer must not require its table in existing production
  // databases. Native special-page bookings use the ordinary app-owned flow.
  if (!getSpecialsConfig()) return false;
  const [mapping] = await db.select({ bookingId: ghlSpecialAppointmentsTable.bookingId })
    .from(ghlSpecialAppointmentsTable)
    .where(eq(ghlSpecialAppointmentsTable.bookingId, bookingId)).limit(1);
  return !!mapping;
}

export const GHL_SCHEDULING_MESSAGE =
  "This special appointment is managed by GoHighLevel. Reschedule or cancel it in its GoHighLevel calendar; the workflow will update this booking.";