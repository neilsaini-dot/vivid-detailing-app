import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const bookingDraftsTable = pgTable("booking_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  vehicleType: text("vehicle_type").notNull().default("car"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBookingId: uuid("completed_booking_id"),
});

export type BookingDraft = typeof bookingDraftsTable.$inferSelect;
