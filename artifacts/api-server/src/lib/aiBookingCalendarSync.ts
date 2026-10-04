import { eq, sql } from "drizzle-orm";
import { db, bookingsTable, ghlSpecialAppointmentsTable, aiBookingConversionsTable } from "@workspace/db";
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "./googleCalendar";
import { aiCalendarEventId } from "./aiBookingConversion";
import { logger } from "./logger";

// Converted bookings still use GHL as the source of truth for their time/status.
// Reuse the one Google event instead of creating an event on every notification.
export async function syncAiBookingCalendar(id: string) {
  const [candidate] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id));
  if (!candidate?.createdByAdmin) return;
  await db.transaction(async tx => {
    const [mapping] = await tx.select().from(ghlSpecialAppointmentsTable).where(eq(ghlSpecialAppointmentsTable.bookingId, id));
    if (!mapping) return;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([mapping.locationId, mapping.appointmentId])}, 0))`);
    const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, id)).for("update");
    const [conversion] = await tx.select().from(aiBookingConversionsTable).where(eq(aiBookingConversionsTable.bookingId, id));
    if (!booking || conversion?.state !== "converted") return;
    let ok = true;
    if (booking.status === "cancelled") {
      if (booking.calendarEventId) ok = await deleteCalendarEvent(booking.calendarEventId);
      if (ok) await tx.update(bookingsTable).set({ calendarEventId: null }).where(eq(bookingsTable.id, id));
    } else if (booking.appointmentAt && mapping.appointmentEndAt && mapping.appointmentEndAt > booking.appointmentAt) {
      const input = {
        summary: "Vivid Detailing - Special booking",
        description: `Booking ID: ${id}\nGoHighLevel appointment: ${mapping.appointmentId}\nSee the app for reviewed customer and vehicle information.`,
        startIso: booking.appointmentAt.toISOString(),
        durationHours: (mapping.appointmentEndAt.getTime() - booking.appointmentAt.getTime()) / 3600000,
      };
      if (booking.calendarEventId) {
        // Patch timing only; retain the rich customer/vehicle description.
        ok = await updateCalendarEvent(booking.calendarEventId, { startIso: input.startIso, durationHours: input.durationHours });
      } else {
        const eventId = await createCalendarEvent({
          ...input, id: aiCalendarEventId(`${id}:reopened:${mapping.externalUpdatedAt?.toISOString() ?? mapping.fingerprint}`), bookingId: id,
        });
        ok = !!eventId;
        if (eventId) {
          await tx.update(bookingsTable).set({ calendarEventId: eventId }).where(eq(bookingsTable.id, id));
          await tx.update(aiBookingConversionsTable).set({ calendarEventId: eventId }).where(eq(aiBookingConversionsTable.bookingId, id));
        }
      }
    }
    await tx.update(aiBookingConversionsTable).set({
      lastError: ok ? null : "GHL appointment was saved, but Google Calendar sync failed. Retry the GHL notification or check the calendar integration.",
    }).where(eq(aiBookingConversionsTable.bookingId, id));
    if (!ok) logger.warn({ bookingId: id }, "Converted AI booking calendar sync failed");
  });
}