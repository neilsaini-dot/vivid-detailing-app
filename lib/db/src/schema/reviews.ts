import { pgTable, uuid, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { bookingsTable } from "./bookings";
import { customersTable } from "./customers";

export const reviewsTable = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").references(() => bookingsTable.id, { onDelete: "set null" }),
  customerId: uuid("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  rating: integer("rating").notNull(),
  feedback: text("feedback"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  redirectedToGoogle: boolean("redirected_to_google").notNull().default(false),
});

export type Review = typeof reviewsTable.$inferSelect;
