import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { bookingsTable } from "./bookings";

export const aiBookingConversionsTable = pgTable("ai_booking_conversions", {
  bookingId: uuid("booking_id").primaryKey().references(() => bookingsTable.id, { onDelete: "cascade" }),
  state: text("state").notNull().default("review"),
  webhookState: text("webhook_state").notNull().default("pending"),
  botOrigin: text("bot_origin"),
  ghlDeleteState: text("ghl_delete_state").notNull().default("pending"),
  ghlDeleteError: text("ghl_delete_error"),
  calendarEventId: text("calendar_event_id"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  lastError: text("last_error"),
});