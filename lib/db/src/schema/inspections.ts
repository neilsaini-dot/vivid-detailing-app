import { pgTable, uuid, text, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";
import { bookingsTable } from "./bookings";

export const inspectionsTable = pgTable("inspections", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").references(() => bookingsTable.id, { onDelete: "cascade" }),
  vehicleSnapshot: jsonb("vehicle_snapshot"),
  damageEntries: jsonb("damage_entries").$type<unknown[]>().default([]),
  dashboardLights: jsonb("dashboard_lights").$type<string[]>().default([]),
  conditionNotes: text("condition_notes"),
  packageOverride: text("package_override"),
  addonsSelected: jsonb("addons_selected").$type<string[]>().default([]),
  estimatedPickupAt: timestamp("estimated_pickup_at", { withTimezone: true }),
  jobNotes: text("job_notes"),
  beforePhotoUrls: text("before_photo_urls").array().default([]),
  signatureUrl: text("signature_url"),
  clientPresent: boolean("client_present").default(true),
  status: text("status").notNull().default("draft"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type Inspection = typeof inspectionsTable.$inferSelect;
export type InsertInspection = typeof inspectionsTable.$inferInsert;
