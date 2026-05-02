import { pgTable, uuid, text, numeric, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const servicesTable = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  pricingRule: text("pricing_rule").notNull(),
  basePrice: numeric("base_price", { precision: 10, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  isSeasonal: boolean("is_seasonal").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  description: text("description"),
  includes: text("includes").array().notNull().default([]),
  showInProtectionStep: boolean("show_in_protection_step").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const servicePricesTable = pgTable("service_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceId: uuid("service_id").notNull().references(() => servicesTable.id, { onDelete: "cascade" }),
  vehicleType: text("vehicle_type").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
});

export const insertServiceSchema = createInsertSchema(servicesTable).omit({ id: true, createdAt: true });
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof servicesTable.$inferSelect;
export type ServicePrice = typeof servicePricesTable.$inferSelect;
