import { pgTable, uuid, text, numeric, boolean, integer, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { vehiclesTable } from "./vehicles";

export const bookingsTable = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  vehicleId: uuid("vehicle_id").references(() => vehiclesTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"),
  appointmentAt: timestamp("appointment_at", { withTimezone: true }),
  totalEstimate: numeric("total_estimate", { precision: 10, scale: 2 }),
  depositPaid: boolean("deposit_paid").notNull().default(false),
  notes: text("notes"),
  ghlContactId: text("ghl_contact_id"),
  ghlOpportunityId: text("ghl_opportunity_id"),
  // Booking origin — online | phone | walkin | referral | other
  source: text("source").notNull().default("online"),
  // True when admin manually overrode the total instead of summing line items
  isManualPriceOverride: boolean("is_manual_price_override").notNull().default(false),
  // True for bookings created through the admin manual booking form
  createdByAdmin: boolean("created_by_admin").notNull().default(false),
  estimatedPickupAt: timestamp("estimated_pickup_at", { withTimezone: true }),
  internalNotes: text("internal_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("booking_status_check", sql`${t.status} IN ('pending','confirmed','completed','cancelled','in_progress')`),
  check("booking_source_check", sql`${t.source} IN ('online','phone','walkin','referral','other')`),
]);

export const bookingItemsTable = pgTable("booking_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
  itemType: text("item_type").notNull(),
  itemName: text("item_name").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }),
  quantity: integer("quantity").notNull().default(1),
  isQuoteBased: boolean("is_quote_based").notNull().default(false),
}, (t) => [
  // 'manual' added for admin free-form line items
  check("booking_item_type_check", sql`${t.itemType} IN ('service','addon','quote','promo','manual')`),
]);

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({ id: true, createdAt: true });
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
export type BookingItem = typeof bookingItemsTable.$inferSelect;
