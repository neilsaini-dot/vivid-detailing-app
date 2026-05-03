import { pgTable, uuid, text, integer, numeric, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { customersTable } from "./customers";
import { bookingsTable } from "./bookings";

export const serviceHistoryTable = pgTable("service_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").references(() => customersTable.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id").references(() => bookingsTable.id, { onDelete: "set null" }),
  conditionScore: integer("condition_score"),
  beforePhotoUrls: text("before_photo_urls").array().notNull().default([]),
  afterPhotoUrls: text("after_photo_urls").array().notNull().default([]),
  notes: text("notes"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  driveFolderUrl: text("drive_folder_url"),
}, (t) => [
  check("condition_score_check", sql`${t.conditionScore} BETWEEN 0 AND 100`),
]);

export const loyaltyActivityTable = pgTable("loyalty_activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").references(() => customersTable.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id"),
  spendAmount: numeric("spend_amount", { precision: 10, scale: 2 }).notNull(),
  tierAtTime: text("tier_at_time").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ghlSyncLogsTable = pgTable("ghl_sync_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id"),
  bookingId: uuid("booking_id"),
  eventType: text("event_type").notNull(),
  payload: text("payload"),
  response: text("response"),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ServiceHistory = typeof serviceHistoryTable.$inferSelect;
export type LoyaltyActivity = typeof loyaltyActivityTable.$inferSelect;
