import { pgTable, text, uuid, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { bookingsTable } from "./bookings";

// Independent mapping preserves idempotency and cancellation tombstones even
// when a cancellation arrives before its creation notification.
export const ghlSpecialAppointmentsTable = pgTable("ghl_special_appointments", {
  locationId: text("location_id").notNull(),
  appointmentId: text("appointment_id").notNull(),
  calendarId: text("calendar_id").notNull(),
  externalContactId: text("external_contact_id"),
  bookingId: uuid("booking_id").references(() => bookingsTable.id, { onDelete: "set null" }),
  externalStatus: text("external_status").notNull(),
  appointmentEndAt: timestamp("appointment_end_at", { withTimezone: true }),
  externalUpdatedAt: timestamp("external_updated_at", { withTimezone: true }),
  fingerprint: text("fingerprint").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.locationId, t.appointmentId] }),
]);

export const insertGhlSpecialAppointmentSchema = createInsertSchema(ghlSpecialAppointmentsTable);
export type GhlSpecialAppointment = typeof ghlSpecialAppointmentsTable.$inferSelect;