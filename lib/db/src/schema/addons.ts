import { pgTable, uuid, text, boolean, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const addOnsTable = pgTable("add_ons", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  categoryGroup: text("category_group").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  showInProtectionStep: boolean("show_in_protection_step").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const addOnPricesTable = pgTable("add_on_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  addOnId: uuid("add_on_id").notNull().references(() => addOnsTable.id, { onDelete: "cascade" }),
  vehicleType: text("vehicle_type").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
});

export const insertAddOnSchema = createInsertSchema(addOnsTable).omit({ id: true });
export type InsertAddOn = z.infer<typeof insertAddOnSchema>;
export type AddOn = typeof addOnsTable.$inferSelect;
export type AddOnPrice = typeof addOnPricesTable.$inferSelect;
