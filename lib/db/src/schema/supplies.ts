import { pgTable, uuid, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";

export const suppliesTable = pgTable("supplies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category"),
  notes: text("notes"),
  isLowStock: boolean("is_low_stock").notNull().default(false),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type Supply = typeof suppliesTable.$inferSelect;
