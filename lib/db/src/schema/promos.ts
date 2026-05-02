import { pgTable, uuid, text, numeric, boolean, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const seasonalPromosTable = pgTable("seasonal_promos", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  basePrice: numeric("base_price", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  description: text("description"),
  includes: text("includes").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSeasonalPromoSchema = createInsertSchema(seasonalPromosTable).omit({ id: true, createdAt: true });
export type InsertSeasonalPromo = z.infer<typeof insertSeasonalPromoSchema>;
export type SeasonalPromo = typeof seasonalPromosTable.$inferSelect;
