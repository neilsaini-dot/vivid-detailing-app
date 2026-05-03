import { Router } from "express";
import { db } from "@workspace/db";
import {
  servicesTable,
  servicePricesTable,
  addOnsTable,
  addOnPricesTable,
  bookingsTable,
  bookingItemsTable,
  customersTable,
  vehiclesTable,
  serviceHistoryTable,
  seasonalPromosTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, asc, sql, sum, count, inArray } from "drizzle-orm";
import {
  AdminUpdateServiceParams,
  AdminUpdateServiceBody,
  AdminUpdateAddOnParams,
  AdminUpdateAddOnBody,
  AdminListBookingsQueryParams,
  AdminUpdateBookingParams,
  AdminUpdateBookingBody,
  AdminUpdateCustomerParams,
  AdminUpdateCustomerBody,
  GetAnalyticsQueryParams,
  UpdateSeasonalPromoBody,
} from "@workspace/api-zod";
import { formatCustomer, formatVehicle, formatBooking } from "./customers";
import { sendGhlBookingConfirmed, sendGhlBookingCompleted } from "../lib/ghl";
import { createCalendarEvent } from "../lib/googleCalendar";
import { ObjectStorageService } from "../lib/objectStorage";
import { syncPhotosToGoogleDrive } from "../lib/googleDrive";

const router = Router();

function formatCompletedAt(date: Date): string {
  const tz = "America/Halifax";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  const day = parseInt(get("day"), 10);
  const ordinal = day % 10 === 1 && day !== 11 ? "st"
    : day % 10 === 2 && day !== 12 ? "nd"
    : day % 10 === 3 && day !== 13 ? "rd"
    : "th";

  return `${get("month")} ${day}${ordinal}, ${get("year")} at ${get("hour")}:${get("minute")}${get("dayPeriod")}`;
}

// ─── Services ─────────────────────────────────────────────────

router.get("/admin/services", async (req, res) => {
  try {
    const services = await db.select().from(servicesTable).orderBy(asc(servicesTable.sortOrder));
    const prices = await db.select().from(servicePricesTable);
    res.json(
      services.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        pricingRule: s.pricingRule,
        basePrice: s.basePrice ? Number(s.basePrice) : null,
        isActive: s.isActive,
        isSeasonal: s.isSeasonal,
        sortOrder: s.sortOrder,
        description: s.description,
        includes: s.includes ?? [],
        showInProtectionStep: s.showInProtectionStep,
        prices: prices
          .filter((p) => p.serviceId === s.id)
          .map((p) => ({ vehicleType: p.vehicleType, price: Number(p.price) })),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list admin services");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/services/:id", async (req, res) => {
  try {
    const { id } = AdminUpdateServiceParams.parse(req.params);
    const body = AdminUpdateServiceBody.parse(req.body);

    const updates: Partial<typeof servicesTable.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.isSeasonal !== undefined) updates.isSeasonal = body.isSeasonal;
    if (body.basePrice !== undefined) updates.basePrice = String(body.basePrice);
    if (body.includes !== undefined) updates.includes = body.includes;

    const [updated] = await db
      .update(servicesTable)
      .set(updates)
      .where(eq(servicesTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Not found" });

    if (body.prices && body.prices.length > 0) {
      await db.delete(servicePricesTable).where(eq(servicePricesTable.serviceId, id));
      await db.insert(servicePricesTable).values(
        body.prices.map((p) => ({
          serviceId: id,
          vehicleType: p.vehicleType,
          price: String(p.price),
        }))
      );
    }

    const prices = await db
      .select()
      .from(servicePricesTable)
      .where(eq(servicePricesTable.serviceId, id));

    res.json({
      id: updated.id,
      name: updated.name,
      category: updated.category,
      pricingRule: updated.pricingRule,
      basePrice: updated.basePrice ? Number(updated.basePrice) : null,
      isActive: updated.isActive,
      isSeasonal: updated.isSeasonal,
      sortOrder: updated.sortOrder,
      description: updated.description,
      includes: updated.includes ?? [],
      showInProtectionStep: updated.showInProtectionStep,
      prices: prices.map((p) => ({ vehicleType: p.vehicleType, price: Number(p.price) })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update service");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Add-ons ─────────────────────────────────────────────────

router.get("/admin/add-ons", async (req, res) => {
  try {
    const addOns = await db.select().from(addOnsTable).orderBy(asc(addOnsTable.sortOrder));
    const prices = await db.select().from(addOnPricesTable);
    res.json(
      addOns.map((a) => ({
        id: a.id,
        name: a.name,
        categoryGroup: a.categoryGroup,
        isActive: a.isActive,
        showInProtectionStep: a.showInProtectionStep,
        sortOrder: a.sortOrder,
        prices: prices
          .filter((p) => p.addOnId === a.id)
          .map((p) => ({ vehicleType: p.vehicleType, price: Number(p.price) })),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list admin add-ons");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/add-ons/:id", async (req, res) => {
  try {
    const { id } = AdminUpdateAddOnParams.parse(req.params);
    const body = AdminUpdateAddOnBody.parse(req.body);

    const updates: Partial<typeof addOnsTable.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    const [updated] = await db
      .update(addOnsTable)
      .set(updates)
      .where(eq(addOnsTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Not found" });

    if (body.prices && body.prices.length > 0) {
      await db.delete(addOnPricesTable).where(eq(addOnPricesTable.addOnId, id));
      await db.insert(addOnPricesTable).values(
        body.prices.map((p) => ({
          addOnId: id,
          vehicleType: p.vehicleType,
          price: String(p.price),
        }))
      );
    }

    const prices = await db
      .select()
      .from(addOnPricesTable)
      .where(eq(addOnPricesTable.addOnId, id));

    res.json({
      id: updated.id,
      name: updated.name,
      categoryGroup: updated.categoryGroup,
      isActive: updated.isActive,
      showInProtectionStep: updated.showInProtectionStep,
      sortOrder: updated.sortOrder,
      prices: prices.map((p) => ({ vehicleType: p.vehicleType, price: Number(p.price) })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update add-on");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Bookings ─────────────────────────────────────────────────

router.get("/admin/bookings", async (req, res) => {
  try {
    const query = AdminListBookingsQueryParams.parse(req.query);

    let bookings = await db
      .select()
      .from(bookingsTable)
      .orderBy(desc(bookingsTable.createdAt));

    if (query.status) {
      bookings = bookings.filter((b) => b.status === query.status);
    }
    if (query.from) {
      const from = new Date(query.from);
      bookings = bookings.filter((b) => !b.appointmentAt || b.appointmentAt >= from);
    }
    if (query.to) {
      const to = new Date(query.to);
      bookings = bookings.filter((b) => !b.appointmentAt || b.appointmentAt <= to);
    }

    const withItems = await Promise.all(
      bookings.map(async (b) => {
        const items = await db
          .select()
          .from(bookingItemsTable)
          .where(eq(bookingItemsTable.bookingId, b.id));
        const customer = b.customerId
          ? (await db.select().from(customersTable).where(eq(customersTable.id, b.customerId)))[0]
          : null;
        const vehicle = b.vehicleId
          ? (await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, b.vehicleId)))[0]
          : null;
        return { ...b, items, customer, vehicle };
      })
    );

    res.json(withItems.map(formatBooking));
  } catch (err) {
    req.log.error({ err }, "Failed to list admin bookings");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/bookings/:id/service-history
router.get("/admin/bookings/:id/service-history", async (req, res) => {
  try {
    const { id } = AdminUpdateBookingParams.parse(req.params);
    const [history] = await db
      .select()
      .from(serviceHistoryTable)
      .where(eq(serviceHistoryTable.bookingId, id))
      .limit(1);
    res.json(history ?? null);
  } catch (err) {
    req.log.error({ err }, "Failed to get service history");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/bookings/:id", async (req, res) => {
  try {
    const { id } = AdminUpdateBookingParams.parse(req.params);
    const body = AdminUpdateBookingBody.parse(req.body);

    const updates: Partial<typeof bookingsTable.$inferInsert> = {};
    if (body.status) updates.status = body.status;
    if (body.appointmentAt) updates.appointmentAt = new Date(body.appointmentAt);
    if (body.notes !== undefined) updates.notes = body.notes;

    const [updated] = await db
      .update(bookingsTable)
      .set(updates)
      .where(eq(bookingsTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Not found" });

    // Fire completion webhook when status transitions to "completed"
    if (body.status === "completed") {
      const items = await db
        .select()
        .from(bookingItemsTable)
        .where(eq(bookingItemsTable.bookingId, id));

      const services = items
        .filter((i) => i.itemType === "service" || i.itemType === "promo")
        .map((i) => i.itemName);
      const addons = items
        .filter((i) => i.itemType === "addon")
        .map((i) => i.itemName);

      let firstName = "";
      let lastName = "";
      let email = "";
      let phone = "";
      let vehicleStr = "";

      if (updated.customerId) {
        const [customer] = await db
          .select()
          .from(customersTable)
          .where(eq(customersTable.id, updated.customerId))
          .limit(1);
        if (customer) {
          const parts = (customer.name ?? "").split(" ");
          firstName = parts[0] ?? "";
          lastName = parts.slice(1).join(" ");
          email = customer.email ?? "";
          phone = customer.phone ?? "";
        }
      }

      if (updated.vehicleId) {
        const [vehicle] = await db
          .select()
          .from(vehiclesTable)
          .where(eq(vehiclesTable.id, updated.vehicleId))
          .limit(1);
        if (vehicle) {
          vehicleStr = [vehicle.year, vehicle.make, vehicle.model]
            .filter(Boolean)
            .join(" ");
        }
      }

      sendGhlBookingCompleted({
        event: "booking_completed",
        status: "completed",
        status_completed: true,
        contact: { firstName, lastName, email, phone },
        booking: {
          id: updated.id,
          services,
          addons,
          vehicle: vehicleStr,
          appointment_at: updated.appointmentAt?.toISOString() ?? null,
          total_estimate: Number(updated.totalEstimate ?? 0),
          notes: updated.notes ?? null,
          completed_at: formatCompletedAt(new Date()),
        },
        source: "vivid-app",
      }).catch(() => {});
    }

    // Upsert service history when photos or condition score are provided
    const hasPhotoData =
      body.conditionScore !== undefined ||
      body.beforePhotoUrls !== undefined ||
      body.afterPhotoUrls !== undefined;

    if (hasPhotoData && updated.customerId) {
      const [existing] = await db
        .select()
        .from(serviceHistoryTable)
        .where(eq(serviceHistoryTable.bookingId, id))
        .limit(1);

      if (existing) {
        await db
          .update(serviceHistoryTable)
          .set({
            conditionScore: body.conditionScore ?? existing.conditionScore,
            beforePhotoUrls: body.beforePhotoUrls ?? existing.beforePhotoUrls,
            afterPhotoUrls: body.afterPhotoUrls ?? existing.afterPhotoUrls,
            completedAt: body.status === "completed" ? new Date() : existing.completedAt,
          })
          .where(eq(serviceHistoryTable.id, existing.id));
      } else {
        await db.insert(serviceHistoryTable).values({
          customerId: updated.customerId,
          bookingId: id,
          conditionScore: body.conditionScore,
          beforePhotoUrls: body.beforePhotoUrls ?? [],
          afterPhotoUrls: body.afterPhotoUrls ?? [],
          completedAt: body.status === "completed" ? new Date() : undefined,
        });
      }
    }

    const items = await db
      .select()
      .from(bookingItemsTable)
      .where(eq(bookingItemsTable.bookingId, id));

    res.json(formatBooking({ ...updated, items, customer: null, vehicle: null }));
  } catch (err) {
    req.log.error({ err }, "Failed to update admin booking");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/bookings/:id/sync-to-drive — upload before/after photos to Google Drive
router.post("/admin/bookings/:id/sync-to-drive", async (req, res) => {
  try {
    const { id } = AdminUpdateBookingParams.parse(req.params);

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, id))
      .limit(1);
    if (!booking) return res.status(404).json({ error: "Not found" });

    const customer = booking.customerId
      ? (await db.select().from(customersTable).where(eq(customersTable.id, booking.customerId)).limit(1))[0]
      : null;

    const [history] = await db
      .select()
      .from(serviceHistoryTable)
      .where(eq(serviceHistoryTable.bookingId, id))
      .limit(1);

    const beforeUrls: string[] = history?.beforePhotoUrls ?? [];
    const afterUrls: string[] = history?.afterPhotoUrls ?? [];

    if (beforeUrls.length === 0 && afterUrls.length === 0) {
      return res.status(400).json({ error: "No photos saved for this booking yet" });
    }

    const storage = new ObjectStorageService();

    const downloadPhoto = async (objectPath: string, index: number, prefix: string) => {
      const file = await storage.getObjectEntityFile(objectPath);
      const [metadata] = await file.getMetadata();
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        const stream = file.createReadStream();
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      const ext = objectPath.split(".").pop() ?? "jpg";
      return {
        name: `${prefix}-${index + 1}.${ext}`,
        data: Buffer.concat(chunks),
        mimeType: (metadata.contentType as string) || "image/jpeg",
      };
    };

    const [beforeBuffers, afterBuffers] = await Promise.all([
      Promise.all(beforeUrls.map((u, i) => downloadPhoto(u, i, "before"))),
      Promise.all(afterUrls.map((u, i) => downloadPhoto(u, i, "after"))),
    ]);

    const customerName = customer?.name ?? "Unknown";
    const bookingDate = (booking.appointmentAt ?? booking.createdAt)
      .toLocaleDateString("en-CA", { timeZone: "America/Halifax" }); // YYYY-MM-DD

    const result = await syncPhotosToGoogleDrive({ customerName, bookingDate, beforeBuffers, afterBuffers });

    // Persist the folder URL in service history
    if (history) {
      await db
        .update(serviceHistoryTable)
        .set({ driveFolderUrl: result.folderUrl })
        .where(eq(serviceHistoryTable.id, history.id));
    } else if (booking.customerId) {
      await db.insert(serviceHistoryTable).values({
        customerId: booking.customerId,
        bookingId: id,
        beforePhotoUrls: [],
        afterPhotoUrls: [],
        driveFolderUrl: result.folderUrl,
      });
    }

    res.json({ folderUrl: result.folderUrl, uploaded: result.uploaded });
  } catch (err) {
    req.log.error({ err }, "Failed to sync photos to Google Drive");
    res.status(500).json({ error: "Failed to sync to Google Drive" });
  }
});

// POST /api/admin/bookings/:id/resync — re-fires GHL webhook + calendar event
router.post("/admin/bookings/:id/resync", async (req, res) => {
  try {
    const { id } = AdminUpdateBookingParams.parse(req.params);

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, id));
    if (!booking) return res.status(404).json({ error: "Not found" });

    const items = await db
      .select()
      .from(bookingItemsTable)
      .where(eq(bookingItemsTable.bookingId, id));

    const customer = booking.customerId
      ? (await db.select().from(customersTable).where(eq(customersTable.id, booking.customerId)))[0]
      : null;
    const vehicle = booking.vehicleId
      ? (await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, booking.vehicleId)))[0]
      : null;

    const serviceItems = items.filter((i) => i.itemType === "service");
    const addonItems = items.filter((i) => i.itemType === "addon");
    const serviceNames = serviceItems.map((i) => i.itemName);
    const addonNames = addonItems.map((i) => i.itemName);
    const total = Number(booking.totalEstimate ?? 0);
    const hasQuote = items.some((i) => i.isQuoteBased);

    const vehicleLabel = vehicle
      ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.type
      : "Vehicle";

    const [firstName, ...rest] = (customer?.name ?? "Guest").trim().split(" ");
    const lastName = rest.join(" ") || "";

    const calendarDescription = [
      `Customer: ${customer?.name ?? ""} | ${customer?.phone ?? ""} | ${customer?.email ?? ""}`,
      `Vehicle: ${vehicleLabel}`,
      `Services: ${serviceNames.join(", ") || "N/A"}`,
      addonNames.length > 0 ? `Add-ons: ${addonNames.join(", ")}` : null,
      `Estimated Total (incl. HST): $${total.toFixed(2)}`,
      booking.notes ? `Notes: ${booking.notes}` : null,
      `Booking ID: ${booking.id}`,
    ]
      .filter(Boolean)
      .join("\n");

    const durationHours = Math.min(2 + Math.max(0, serviceNames.length - 1), 6);

    await sendGhlBookingConfirmed({
      event: "booking_confirmed",
      contact: {
        firstName,
        lastName,
        email: customer?.email ?? "",
        phone: customer?.phone ?? "",
        tags: ["Booking", "Vivid Detailing", "Resync", ...serviceNames],
      },
      opportunity: {
        title: `${serviceNames[0] ?? "Detailing"} - ${vehicleLabel}`,
        status: "won",
        monetaryValue: total,
        pipelineStageName: "Won",
        notes: calendarDescription,
      },
      booking: {
        id: booking.id,
        services: serviceNames,
        addons: addonNames,
        vehicle: vehicleLabel,
        appointment_at: booking.appointmentAt?.toISOString() ?? null,
        total_estimate: total,
        is_quote_based: hasQuote,
        notes: booking.notes ?? null,
      },
      source: "vivid-app",
    });

    if (booking.appointmentAt) {
      await createCalendarEvent({
        summary: `Vivid Detailing - ${customer?.name ?? "Customer"} - ${serviceNames.join(", ") || "Appointment"}`,
        description: calendarDescription,
        startIso: booking.appointmentAt.toISOString(),
        durationHours,
      });
    }

    res.json({ success: true, resynced: { ghl: true, calendar: !!booking.appointmentAt } });
  } catch (err) {
    req.log.error({ err }, "Failed to resync booking");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Customers ─────────────────────────────────────────────────

router.get("/admin/customers", async (req, res) => {
  try {
    const customers = await db
      .select()
      .from(customersTable)
      .orderBy(desc(customersTable.createdAt));
    res.json(customers.map(formatCustomer));
  } catch (err) {
    req.log.error({ err }, "Failed to list admin customers");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/customers/:id", async (req, res) => {
  try {
    const { id } = AdminUpdateCustomerParams.parse(req.params);
    const body = AdminUpdateCustomerBody.parse(req.body);

    const updates: Partial<typeof customersTable.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.phone !== undefined) updates.phone = body.phone;

    const [updated] = await db
      .update(customersTable)
      .set(updates)
      .where(eq(customersTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(formatCustomer(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to update admin customer");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Analytics ─────────────────────────────────────────────────

router.get("/admin/analytics", async (req, res) => {
  try {
    const query = GetAnalyticsQueryParams.parse(req.query);

    let bookings = await db
      .select()
      .from(bookingsTable)
      .orderBy(desc(bookingsTable.createdAt));

    if (query.from) {
      const from = new Date(query.from);
      bookings = bookings.filter((b) => b.createdAt >= from);
    }
    if (query.to) {
      const to = new Date(query.to);
      bookings = bookings.filter((b) => b.createdAt <= to);
    }

    const completed = bookings.filter((b) => b.status === "completed");
    const pending = bookings.filter((b) => b.status === "pending");
    const totalRevenue = bookings.reduce((s, b) => s + Number(b.totalEstimate ?? 0), 0);

    // Revenue by category
    const allItems = await db.select().from(bookingItemsTable);
    const categoryRevenue: Record<string, { revenue: number; count: number }> = {};

    for (const item of allItems.filter((i) => i.itemType === "service" || i.itemType === "promo")) {
      const booking = bookings.find((b) => b.id === item.bookingId);
      if (!booking) continue;
      const cat = "Service";
      if (!categoryRevenue[cat]) categoryRevenue[cat] = { revenue: 0, count: 0 };
      categoryRevenue[cat].revenue += Number(item.unitPrice ?? 0);
      categoryRevenue[cat].count++;
    }

    // Use service categories from services table
    const services = await db.select().from(servicesTable);
    const serviceCatMap: Record<string, string> = {};
    for (const s of services) serviceCatMap[s.name] = s.category;

    const catRevMap: Record<string, { revenue: number; count: number }> = {};
    for (const item of allItems.filter((i) => i.itemType === "service" || i.itemType === "promo")) {
      const booking = bookings.find((b) => b.id === item.bookingId);
      if (!booking) continue;
      const cat = serviceCatMap[item.itemName] ?? item.itemName;
      if (!catRevMap[cat]) catRevMap[cat] = { revenue: 0, count: 0 };
      catRevMap[cat].revenue += Number(item.unitPrice ?? 0);
      catRevMap[cat].count++;
    }

    const revenueByCategory = Object.entries(catRevMap).map(([category, v]) => ({
      category,
      revenue: Math.round(v.revenue * 100) / 100,
      bookingCount: v.count,
    }));

    // Popular add-ons
    const addonCounts: Record<string, { count: number; revenue: number }> = {};
    for (const item of allItems.filter((i) => i.itemType === "addon")) {
      const booking = bookings.find((b) => b.id === item.bookingId);
      if (!booking) continue;
      if (!addonCounts[item.itemName]) addonCounts[item.itemName] = { count: 0, revenue: 0 };
      addonCounts[item.itemName].count++;
      addonCounts[item.itemName].revenue += Number(item.unitPrice ?? 0);
    }

    const popularAddOns = Object.entries(addonCounts)
      .map(([name, v]) => ({ name, count: v.count, revenue: Math.round(v.revenue * 100) / 100 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.json({
      revenueByCategory,
      popularAddOns,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalBookings: bookings.length,
      completedBookings: completed.length,
      pendingBookings: pending.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get analytics");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Seasonal Promos ─────────────────────────────────────────────────

function formatPromo(p: typeof seasonalPromosTable.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    basePrice: Number(p.basePrice),
    isActive: p.isActive,
    validFrom: p.validFrom ?? null,
    validTo: p.validTo ?? null,
    description: p.description ?? null,
    includes: p.includes ?? [],
  };
}

router.get("/admin/seasonal-promos", async (req, res) => {
  try {
    const promos = await db.select().from(seasonalPromosTable).orderBy(asc(seasonalPromosTable.createdAt));
    res.json(promos.map(formatPromo));
  } catch (err) {
    req.log.error({ err }, "Failed to list promos");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/seasonal-promos", async (req, res) => {
  try {
    const body = req.body as {
      name: string;
      basePrice: number;
      description?: string;
      validFrom?: string | null;
      validTo?: string | null;
      includes?: string[];
      isActive?: boolean;
    };
    if (!body.name || body.basePrice == null) {
      return res.status(400).json({ error: "name and basePrice are required" });
    }
    const [created] = await db
      .insert(seasonalPromosTable)
      .values({
        name: body.name,
        basePrice: String(body.basePrice),
        description: body.description ?? null,
        validFrom: body.validFrom ?? null,
        validTo: body.validTo ?? null,
        includes: body.includes ?? [],
        isActive: body.isActive ?? true,
      })
      .returning();
    res.status(201).json(formatPromo(created));
  } catch (err) {
    req.log.error({ err }, "Failed to create promo");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/seasonal-promos", async (req, res) => {
  try {
    const body = UpdateSeasonalPromoBody.parse(req.body);
    const updates: Partial<typeof seasonalPromosTable.$inferInsert> = {};
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.basePrice !== undefined) updates.basePrice = String(body.basePrice);
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if ("validFrom" in body) updates.validFrom = (body as any).validFrom ?? null;
    if ("validTo" in body) updates.validTo = (body as any).validTo ?? null;
    if ((body as any).includes !== undefined) updates.includes = (body as any).includes;

    const [updated] = await db
      .update(seasonalPromosTable)
      .set(updates)
      .where(eq(seasonalPromosTable.id, body.id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(formatPromo(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to update promo");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/seasonal-promos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(seasonalPromosTable).where(eq(seasonalPromosTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete promo");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/merge-customers — merge duplicate customers by email/phone
// Runs a full dedup pass: consolidates all records that share email or phone
// into the oldest surviving record. Safe to call multiple times.
router.post("/admin/merge-customers", async (req, res) => {
  try {
    const all = await db.select().from(customersTable).orderBy(asc(sql`created_at`));

    // Helper: normalize phone for comparison
    const norm = (p: string | null) => (p ?? "").replace(/\D/g, "");

    // Union-find to group duplicates
    const parent: Record<string, string> = {};
    const find = (x: string): string => {
      if (!parent[x] || parent[x] === x) return x;
      parent[x] = find(parent[x]);
      return parent[x];
    };
    const union = (a: string, b: string) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[rb] = ra; // earlier one (ra) wins since sorted asc
    };

    all.forEach(c => { parent[c.id] = c.id; });

    // Group by email
    const byEmail: Record<string, string[]> = {};
    const byPhone: Record<string, string[]> = {};
    for (const c of all) {
      if (c.email) { byEmail[c.email] = [...(byEmail[c.email] ?? []), c.id]; }
      const p = norm(c.phone);
      if (p.length >= 7) { byPhone[p] = [...(byPhone[p] ?? []), c.id]; }
    }
    for (const ids of Object.values(byEmail)) ids.reduce((a, b) => { union(a, b); return a; });
    for (const ids of Object.values(byPhone)) ids.reduce((a, b) => { union(a, b); return a; });

    // Resolve canonical IDs
    const groups: Record<string, string[]> = {};
    for (const c of all) {
      const canon = find(c.id);
      if (canon !== c.id) groups[canon] = [...(groups[canon] ?? []), c.id];
    }

    let merged = 0;
    for (const [canonId, dupeIds] of Object.entries(groups)) {
      if (dupeIds.length === 0) continue;
      // Re-point related rows
      for (const dupeId of dupeIds) {
        await db.update(bookingsTable).set({ customerId: canonId }).where(eq(bookingsTable.customerId, dupeId));
        await db.update(vehiclesTable).set({ customerId: canonId } as any).where(eq(vehiclesTable.customerId as any, dupeId));
        // Patch email/phone onto canonical if missing
        const dupe = all.find(c => c.id === dupeId);
        const canon = all.find(c => c.id === canonId);
        if (dupe && canon) {
          const patch: any = {};
          if (!canon.email && dupe.email) patch.email = dupe.email;
          if (!canon.phone && dupe.phone) patch.phone = dupe.phone;
          if (canon.name?.trim().length && !canon.name.includes(" ") && dupe.name?.includes(" ")) patch.name = dupe.name;
          if (Object.keys(patch).length > 0) await db.update(customersTable).set(patch).where(eq(customersTable.id, canonId));
        }
        await db.delete(customersTable).where(eq(customersTable.id, dupeId));
        merged++;
      }
    }

    res.json({ ok: true, merged, groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])) });
  } catch (err) {
    req.log.error({ err }, "Failed to merge customers");
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/admin/bookings/bulk-delete — permanently delete multiple bookings
router.post("/admin/bookings/bulk-delete", async (req, res) => {
  try {
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids must be a non-empty array" });
    }
    // Delete child records first to satisfy FK constraints
    await db.delete(bookingItemsTable).where(inArray(bookingItemsTable.bookingId, ids));
    await db.delete(serviceHistoryTable).where(inArray(serviceHistoryTable.bookingId, ids));
    const deleted = await db.delete(bookingsTable).where(inArray(bookingsTable.id, ids)).returning({ id: bookingsTable.id });
    res.json({ ok: true, deleted: deleted.length });
  } catch (err) {
    req.log.error({ err }, "Failed to bulk-delete bookings");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/bookings/bulk-status — change status for multiple bookings
router.post("/admin/bookings/bulk-status", async (req, res) => {
  try {
    const { ids, status } = req.body as { ids: string[]; status: string };
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids must be a non-empty array" });
    }
    const validStatuses = ["pending", "confirmed", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const updated = await db
      .update(bookingsTable)
      .set({ status: status as any })
      .where(inArray(bookingsTable.id, ids))
      .returning({ id: bookingsTable.id });
    res.json({ ok: true, updated: updated.length });
  } catch (err) {
    req.log.error({ err }, "Failed to bulk-update booking status");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
