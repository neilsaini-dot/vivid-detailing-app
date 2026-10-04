import { db, ghlSpecialAppointmentsTable, aiBookingConversionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSpecialsConfig } from "./ghlSpecialsConfig";

export async function isGhlSpecialBooking(bookingId: string, database: Pick<typeof db, "select"> = db, enabled = Boolean(getSpecialsConfig())): Promise<boolean> {
  // A disabled optional importer must not require its table in existing production
  // databases. Native special-page bookings use the ordinary app-owned flow.
  if (!enabled) return false;
  const [mapping] = await database.select({ bookingId: ghlSpecialAppointmentsTable.bookingId })
    .from(ghlSpecialAppointmentsTable)
    .where(eq(ghlSpecialAppointmentsTable.bookingId, bookingId)).limit(1);
  if (!mapping) return false;
  try {
    const [conversion] = await database.select({ state: aiBookingConversionsTable.state })
      .from(aiBookingConversionsTable).where(eq(aiBookingConversionsTable.bookingId, bookingId));
    return conversion?.state !== "converted";
  } catch (cause) {
    const code = cause as { code?: string; cause?: { code?: string } };
    // Without the optional conversion table, ownership cannot have been
    // transferred. Keep pre-conversion GHL scheduling protected.
    if (code.code === "42P01" || code.cause?.code === "42P01") return true;
    throw cause;
  }
}

export const GHL_SCHEDULING_MESSAGE =
  "This special appointment is managed by GoHighLevel. Reschedule or cancel it in its GoHighLevel calendar; the workflow will update this booking.";

export async function isAiConvertedBooking(bookingId: string): Promise<boolean> {
  try {
    const [conversion] = await db.select({ state: aiBookingConversionsTable.state })
      .from(aiBookingConversionsTable).where(eq(aiBookingConversionsTable.bookingId, bookingId));
    return conversion?.state === "converted";
  } catch (cause) {
    const code = cause as { code?: string; cause?: { code?: string } };
    if (code.code === "42P01" || code.cause?.code === "42P01") return false;
    throw cause;
  }
}

export async function hasPendingCalendarConversion(bookingId: string): Promise<boolean> {
  try {
    const [conversion] = await db.select({ state: aiBookingConversionsTable.state, origin: aiBookingConversionsTable.botOrigin })
      .from(aiBookingConversionsTable).where(eq(aiBookingConversionsTable.bookingId, bookingId));
    return conversion?.origin === "google_calendar" && conversion.state !== "converted";
  } catch (cause) {
    const code = cause as { code?: string; cause?: { code?: string } };
    if (code.code === "42P01" || code.cause?.code === "42P01") return false;
    throw cause;
  }
}