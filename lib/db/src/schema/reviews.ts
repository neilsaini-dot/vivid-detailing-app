import { pgTable, uuid, text, integer, boolean, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
}, (t) => [
  check("reviews_rating_check", sql`${t.rating} BETWEEN 1 AND 5`),
]);

export type Review = typeof reviewsTable.$inferSelect;
