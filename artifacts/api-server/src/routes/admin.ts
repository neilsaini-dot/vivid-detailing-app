import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  servicesTable,
  servicePricesTable,
  addOnsTable,
  addOnPricesTable,
  bookingsTable,
  bookingItemsTable,
  bookingDraftsTable,
  reviewsTable,
  customersTable,
  vehiclesTable,
  serviceHistoryTable,
  seasonalPromosTable,
  suppliesTable,
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
  AdminCreateBookingBody,
  AdminSearchCustomersQueryParams,
} from "@workspace/api-zod";
import { ilike, or } from "drizzle-orm";
import { formatCustomer, formatVehicle, formatBooking } from "./customers";
import { sendGhlBookingConfirmed, sendGhlBookingCompleted, sendGhlMagicLink, sendGhlPickupTimeSet } from "../lib/ghl";
import { createCalendarEvent } from "../lib/googleCalendar";
import { googleFetch } from "../lib/googleAuth";
import { downloadFile } from "../lib/supabaseStorage";
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

/**
 * Parse a naive datetime string (e.g. "2026-05-05T09:00" from a datetime-local
 * input) as America/Halifax local time and return the correct UTC Date.
 *
 * Without this, Node.js treats the string as server-local (UTC) time, which
 * shifts a 9:00 AM ADT entry to 9:00 AM UTC = 6:00 AM ADT on the calendar.
 */
function parseHalifaxDatetime(str: string): Date {
  // Parse naively as UTC so we have a reference point near the right date.
  const naive = new Date(str + "Z");

  // Ask Intl what Halifax shows for that UTC instant.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Halifax",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(naive);
  const gp = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? "0", 10);

  // Reconstruct what Halifax-local reads for the naive UTC instant.
  const halifaxAsUtcMs = Date.UTC(gp("year"), gp("month") - 1, gp("day"), gp("hour") % 24, gp("minute"), gp("second"));
  // offsetMs = Halifax-behind-UTC (negative for ADT/AST).
  const offsetMs = halifaxAsUtcMs - naive.getTime();
  // Shift: the user *meant* `str` as Halifax time → subtract offset to get real UTC.
  return new Date(naive.getTime() - offsetMs);
}

/**
 * Format a UTC Date as "May 05, 2026 at 9:00am" in America/Halifax (ADT/AST)
 * for display in GHL webhook payloads / emails.
 */
function formatHalifaxForGhl(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Halifax",
    month: "long",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const ampm = get("dayPeriod").toLowerCase().replace(/\./g, ""); // "am" / "pm"
  return `${get("month")} ${get("day")}, ${get("year")} at ${get("hour")}:${get("minute")}${ampm}`;
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
    if (query.source) {
      bookings = bookings.filter((b) => b.source === query.source);
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

    // Fetch existing booking upfront when pickup time is being set (need old value to detect change)
    let existingPickupAt: Date | null = null;
    if (body.estimatedPickupAt !== undefined) {
      const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Not found" });
      existingPickupAt = existing.estimatedPickupAt ?? null;
    }

    const updates: Partial<typeof bookingsTable.$inferInsert> = {};
    if (body.status) updates.status = body.status;
    if (body.appointmentAt) updates.appointmentAt = new Date(body.appointmentAt);
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.internalNotes !== undefined) updates.internalNotes = body.internalNotes ?? null;
    if (body.estimatedPickupAt !== undefined) {
      updates.estimatedPickupAt = body.estimatedPickupAt ? parseHalifaxDatetime(body.estimatedPickupAt) : null;
    }

    // Only run UPDATE when there are booking-level fields to change.
    // Photo-only saves send no booking fields, which would cause Drizzle
    // to throw "No values to set" on an empty UPDATE.
    let updated: typeof bookingsTable.$inferSelect;
    if (Object.keys(updates).length > 0) {
      const [row] = await db
        .update(bookingsTable)
        .set(updates)
        .where(eq(bookingsTable.id, id))
        .returning();
      if (!row) return res.status(404).json({ error: "Not found" });
      updated = row;
    } else {
      const [row] = await db
        .select()
        .from(bookingsTable)
        .where(eq(bookingsTable.id, id))
        .limit(1);
      if (!row) return res.status(404).json({ error: "Not found" });
      updated = row;
    }

    // Handle line item replacement
    if (body.lineItems && body.lineItems.length > 0) {
      await db.delete(bookingItemsTable).where(eq(bookingItemsTable.bookingId, id));
      await db.insert(bookingItemsTable).values(
        body.lineItems.map((li) => ({
          bookingId: id,
          itemType: "manual" as const,
          itemName: li.description,
          unitPrice: String(li.price),
          quantity: 1,
          isQuoteBased: false,
        }))
      );
      const lineItemsTotal = body.lineItems.reduce((sum, li) => sum + li.price, 0);
      const editSubtotal = body.isManualPriceOverride && body.totalOverride != null
        ? body.totalOverride
        : lineItemsTotal;
      const newTotal = Math.round(editSubtotal * 1.15 * 100) / 100;
      const [refreshed] = await db
        .update(bookingsTable)
        .set({ totalEstimate: String(newTotal), isManualPriceOverride: body.isManualPriceOverride ?? false })
        .where(eq(bookingsTable.id, id))
        .returning();
      if (refreshed) updated = refreshed;
    }

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
          rating_link: `https://book.vividpei.com/review?booking_id=${updated.id}`,
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

    // Fire pickup time webhook when estimatedPickupAt is set or changed
    if (
      body.estimatedPickupAt &&
      updated.estimatedPickupAt &&
      existingPickupAt?.getTime() !== updated.estimatedPickupAt.getTime()
    ) {
      let firstName = "";
      let lastName = "";
      let email = "";
      let phone = "";
      if (updated.customerId) {
        const [customer] = await db
          .select().from(customersTable)
          .where(eq(customersTable.id, updated.customerId)).limit(1);
        if (customer) {
          const parts = (customer.name ?? "").split(" ");
          firstName = parts[0] ?? "";
          lastName = parts.slice(1).join(" ");
          email = customer.email ?? "";
          phone = customer.phone ?? "";
        }
      }
      const formatADT = (date: Date): string =>
        date.toLocaleString("en-CA", {
          timeZone: "America/Halifax",
          month: "long",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }).replace(/(\w+ \d+, \d+),/, "$1 at");

      sendGhlPickupTimeSet({
        event: "pickup_time_set",
        pickup_time_set: true,
        contact: { firstName, lastName, email, phone },
        booking: {
          id: updated.id,
          appointment_at: updated.appointmentAt?.toISOString() ?? null,
          appointment_at_formatted: updated.appointmentAt ? formatADT(updated.appointmentAt) : null,
          estimated_pickup_at: updated.estimatedPickupAt.toISOString(),
          estimated_pickup_at_formatted: formatADT(updated.estimatedPickupAt),
        },
        source: "vivid-app",
      }).catch(() => {});
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

// GET /api/admin/calendar/day-summary?date=YYYY-MM-DD
router.get("/admin/calendar/day-summary", async (req, res) => {
  try {
    const date = String(req.query.date ?? "");
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
    }
    const dayStart = parseHalifaxDatetime(`${date}T00:00:00`);
    const dayEnd = parseHalifaxDatetime(`${date}T23:59:59`);

    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(dayStart.toISOString())}&timeMax=${encodeURIComponent(dayEnd.toISOString())}&singleEvents=true&orderBy=startTime`;
    let events: { summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string } }[] = [];
    try {
      const gcalRes = await googleFetch(url);
      if (gcalRes.ok) {
        const data = await gcalRes.json() as { items?: typeof events };
        events = (data?.items ?? []).filter(e => e.start?.dateTime);
      }
    } catch {
      // non-fatal — return empty
    }

    res.json({
      date,
      eventCount: events.length,
      events: events.map(e => ({
        title: e.summary ?? "Appointment",
        start: e.start?.dateTime ?? null,
        end: e.end?.dateTime ?? null,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get calendar day summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/calendar/events?year=YYYY&month=MM
router.get("/admin/calendar/events", async (req, res) => {
  try {
    const year = parseInt(String(req.query.year ?? new Date().getFullYear()));
    const month = parseInt(String(req.query.month ?? new Date().getMonth() + 1));
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: "Invalid year/month" });
    }
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(monthStart.toISOString())}&timeMax=${encodeURIComponent(monthEnd.toISOString())}&singleEvents=true&orderBy=startTime&maxResults=200`;

    let events: { id?: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string } }[] = [];
    try {
      const gcalRes = await googleFetch(url);
      if (gcalRes.ok) {
        const data = await gcalRes.json() as { items?: typeof events };
        events = data?.items ?? [];
      }
    } catch {
      // non-fatal
    }

    res.json(events.map(e => ({
      id: e.id ?? "",
      title: e.summary ?? "Appointment",
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? null,
      allDay: !e.start?.dateTime,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to get calendar events");
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

    const downloadPhoto = async (urlOrPath: string, index: number, prefix: string) => {
      const { data, contentType } = await downloadFile(urlOrPath);
      const ext = urlOrPath.split("?")[0].split(".").pop() ?? "jpg";
      return {
        name: `${prefix}-${index + 1}.${ext}`,
        data,
        mimeType: contentType || "image/jpeg",
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
      booking_confirmed: true,
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
        appointment_at: booking.appointmentAt ? formatHalifaxForGhl(booking.appointmentAt) : null,
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

// GET /api/admin/customers/search — search customers by name/email/phone
router.get("/admin/customers/search", async (req, res) => {
  try {
    const { q } = AdminSearchCustomersQueryParams.parse(req.query);
    const pattern = `%${q}%`;
    // Strip all non-numeric chars from both stored phone and the query so that
    // "9022677775", "902-267-7775", and "(902) 267-7775" all match each other.
    const digitsOnly = q.replace(/\D/g, "");
    const phonePattern = `%${digitsOnly}%`;
    const customers = await db
      .select()
      .from(customersTable)
      .where(
        or(
          ilike(customersTable.name, pattern),
          ilike(customersTable.email, pattern),
          ilike(customersTable.phone, pattern),
          // Normalised phone match — only run when there are digits to compare
          digitsOnly.length >= 2
            ? sql`regexp_replace(${customersTable.phone}, '[^0-9]', '', 'g') ILIKE ${phonePattern}`
            : sql`false`,
        )
      )
      .orderBy(asc(customersTable.name))
      .limit(20);

    const results = await Promise.all(
      customers.map(async (c) => {
        const vehicles = await db
          .select()
          .from(vehiclesTable)
          .where(eq(vehiclesTable.customerId, c.id))
          .orderBy(desc(vehiclesTable.createdAt));
        return {
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          vehicles: vehicles.map(formatVehicle),
        };
      })
    );
    res.json(results);
  } catch (err) {
    req.log.error({ err }, "Failed to search customers");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/bookings — create a manual booking from the admin panel
router.post("/admin/bookings", async (req, res) => {
  try {
    const body = AdminCreateBookingBody.parse(req.body);

    // ── 1. Resolve or create customer ────────────────────────────
    let customerId: string | null = null;
    let customerRecord: (typeof customersTable.$inferSelect) | null = null;

    if (body.customerId) {
      const [found] = await db.select().from(customersTable).where(eq(customersTable.id, body.customerId)).limit(1);
      if (!found) return res.status(400).json({ error: "Customer not found" });
      customerId = found.id;
      customerRecord = found;
    } else if (body.newCustomer) {
      const nameParts = body.newCustomer.name.trim().split(" ");
      const [created] = await db
        .insert(customersTable)
        .values({
          name: body.newCustomer.name.trim(),
          email: body.newCustomer.email ?? null,
          phone: body.newCustomer.phone ?? null,
          ghlSyncStatus: "pending",
        })
        .returning();
      customerId = created.id;
      customerRecord = created;
      void nameParts; // suppress unused warning
    }

    // ── 2. Resolve or create vehicle ─────────────────────────────
    let vehicleId: string | null = null;
    let vehicleRecord: (typeof vehiclesTable.$inferSelect) | null = null;

    if (body.vehicleId) {
      const [found] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, body.vehicleId)).limit(1);
      if (found) { vehicleId = found.id; vehicleRecord = found; }
    } else if (body.newVehicle && customerId) {
      const [created] = await db
        .insert(vehiclesTable)
        .values({ ...body.newVehicle, customerId })
        .returning();
      vehicleId = created.id;
      vehicleRecord = created;
    }

    // ── 3. Compute total ─────────────────────────────────────────
    // totalEstimate is always stored as the grand total (tax-included).
    const lineItemsTotal = body.lineItems.reduce((sum, li) => sum + li.price, 0);
    const subtotal = body.isManualPriceOverride && body.totalOverride != null
      ? body.totalOverride
      : lineItemsTotal;
    const total = Math.round(subtotal * 1.15 * 100) / 100;

    // ── 4. Create booking ────────────────────────────────────────
    const [booking] = await db
      .insert(bookingsTable)
      .values({
        customerId,
        vehicleId,
        status: body.status ?? "pending",
        appointmentAt: body.appointmentAt ? parseHalifaxDatetime(body.appointmentAt) : null,
        totalEstimate: String(total),
        depositPaid: false,
        notes: body.notes ?? null,
        source: body.source,
        isManualPriceOverride: body.isManualPriceOverride ?? false,
        createdByAdmin: true,
      })
      .returning();

    // ── 5. Create line items ──────────────────────────────────────
    if (body.lineItems.length > 0) {
      await db.insert(bookingItemsTable).values(
        body.lineItems.map((li) => ({
          bookingId: booking.id,
          itemType: "manual" as const,
          itemName: li.description,
          unitPrice: String(li.price),
          quantity: 1,
          isQuoteBased: false,
        }))
      );
    }

    // ── 5.5 Send portal magic link to customer ────────────────────
    // Always fire for every manual booking so the customer can track it,
    // regardless of status. Uses the booking ID as the ?ref= parameter.
    if (customerRecord) {
      try {
        const rawDomain = process.env.NEXT_PUBLIC_APP_URL
          ?? process.env.REPLIT_DOMAINS?.split(",")[0]?.trim()
          ?? "";
        const appUrl = rawDomain.startsWith("http")
          ? rawDomain.replace(/\/$/, "")
          : rawDomain ? `https://${rawDomain}` : "";
        const portalUrl = appUrl
          ? `${appUrl}/dashboard?ref=${booking.id}`
          : `/dashboard?ref=${booking.id}`;

        const nameParts = (customerRecord.name ?? "").trim().split(" ");
        await sendGhlMagicLink({
          event: "magic_link_requested",
          contact: {
            firstName: nameParts[0] ?? "",
            lastName: nameParts.slice(1).join(" ") ?? "",
            email: customerRecord.email ?? "",
            phone: customerRecord.phone ?? "",
          },
          magicLinkUrl: portalUrl,
          source: "vivid-app",
        });
      } catch (err) {
        req.log.warn({ err }, "Magic link webhook failed for manual booking");
      }
    }

    // ── 6. Create service history if photos provided ──────────────
    if (body.beforePhotoUrls?.length || body.afterPhotoUrls?.length || body.conditionScore != null) {
      await db.insert(serviceHistoryTable).values({
        bookingId: booking.id,
        conditionScore: body.conditionScore ?? null,
        beforePhotoUrls: body.beforePhotoUrls ?? [],
        afterPhotoUrls: body.afterPhotoUrls ?? [],
      });
    }

    // ── 7. GHL + Calendar if confirmed ───────────────────────────
    if (booking.status === "confirmed" && customerRecord) {
      const items = await db.select().from(bookingItemsTable).where(eq(bookingItemsTable.bookingId, booking.id));
      const primaryService = items[0]?.itemName ?? "Detailing Service";

      const vehicleLabel = vehicleRecord
        ? [vehicleRecord.year, vehicleRecord.make, vehicleRecord.model].filter(Boolean).join(" ")
        : "";

      try {
        await sendGhlBookingConfirmed({
          event: "booking_confirmed",
          booking_confirmed: true,
          source: "vivid-app",
          contact: {
            firstName: customerRecord.name?.split(" ")[0] ?? customerRecord.name ?? "",
            lastName: customerRecord.name?.split(" ").slice(1).join(" ") ?? "",
            email: customerRecord.email ?? "",
            phone: customerRecord.phone ?? "",
            tags: ["Booking", "Vivid Detailing", primaryService],
          },
          opportunity: {
            title: `${customerRecord.name ?? "Client"} — ${primaryService}`,
            status: "won",
            monetaryValue: Number(booking.totalEstimate ?? 0),
            pipelineStageName: "Won",
            notes: booking.notes ?? "",
          },
          booking: {
            id: booking.id,
            services: [primaryService],
            addons: [],
            vehicle: vehicleLabel,
            appointment_at: booking.appointmentAt ? formatHalifaxForGhl(booking.appointmentAt) : null,
            total_estimate: Number(booking.totalEstimate ?? 0),
            is_quote_based: false,
            notes: booking.notes ?? null,
          },
        });
      } catch (err) {
        req.log.warn({ err }, "GHL webhook failed for manual booking");
      }

      if (booking.appointmentAt) {
        try {
          await createCalendarEvent({
            summary: `Vivid Detailing — ${customerRecord.name ?? "Client"} (${primaryService})`,
            description: [
              vehicleLabel ? `Vehicle: ${vehicleLabel}` : null,
              booking.notes ? `Notes: ${booking.notes}` : null,
              `Source: ${booking.source} (admin created)`,
            ].filter(Boolean).join("\n"),
            startIso: booking.appointmentAt.toISOString(),
            durationHours: 3,
          });
        } catch (err) {
          req.log.warn({ err }, "Calendar event creation failed for manual booking");
        }
      }
    }

    // ── 8. Return enriched booking ────────────────────────────────
    const items = await db.select().from(bookingItemsTable).where(eq(bookingItemsTable.bookingId, booking.id));
    res.status(201).json(formatBooking({ ...booking, items, customer: customerRecord, vehicle: vehicleRecord }));
  } catch (err) {
    req.log.error({ err }, "Failed to create manual booking");
    res.status(500).json({ error: "Internal server error" });
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

// GET /api/admin/reviews — list customer reviews with optional rating filter
router.get("/admin/reviews", async (req, res) => {
  try {
    const ratingFilter = req.query.rating ? parseInt(req.query.rating as string, 10) : null;
    const rows = await db
      .select({
        id: reviewsTable.id,
        bookingId: reviewsTable.bookingId,
        customerId: reviewsTable.customerId,
        rating: reviewsTable.rating,
        feedback: reviewsTable.feedback,
        submittedAt: reviewsTable.submittedAt,
        redirectedToGoogle: reviewsTable.redirectedToGoogle,
        customerName: customersTable.name,
        vehicleYear: vehiclesTable.year,
        vehicleMake: vehiclesTable.make,
        vehicleModel: vehiclesTable.model,
      })
      .from(reviewsTable)
      .leftJoin(customersTable, eq(reviewsTable.customerId, customersTable.id))
      .leftJoin(bookingsTable, eq(reviewsTable.bookingId, bookingsTable.id))
      .leftJoin(vehiclesTable, eq(bookingsTable.vehicleId, vehiclesTable.id))
      .where(ratingFilter ? eq(reviewsTable.rating, ratingFilter) : undefined)
      .orderBy(desc(reviewsTable.submittedAt));
    res.json(rows.map(r => ({
      id: r.id,
      bookingId: r.bookingId ?? null,
      customerId: r.customerId ?? null,
      customerName: r.customerName ?? null,
      vehicle: [r.vehicleYear, r.vehicleMake, r.vehicleModel].filter(Boolean).join(" ") || null,
      rating: r.rating,
      feedback: r.feedback ?? null,
      submittedAt: r.submittedAt.toISOString(),
      redirectedToGoogle: r.redirectedToGoogle,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list reviews");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/booking-drafts — list incomplete (not yet completed) drafts
router.get("/admin/booking-drafts", async (req, res) => {
  try {
    const drafts = await db
      .select()
      .from(bookingDraftsTable)
      .where(sql`${bookingDraftsTable.completedAt} IS NULL`)
      .orderBy(desc(bookingDraftsTable.startedAt));
    res.json(drafts.map(d => ({
      id: d.id,
      name: d.name,
      phone: d.phone,
      vehicleType: d.vehicleType,
      startedAt: d.startedAt.toISOString(),
      completedAt: d.completedAt?.toISOString() ?? null,
      completedBookingId: d.completedBookingId ?? null,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list booking drafts");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/admin/booking-drafts/:id — dismiss a draft
router.delete("/admin/booking-drafts/:id", async (req, res) => {
  try {
    await db.delete(bookingDraftsTable).where(eq(bookingDraftsTable.id, req.params.id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete booking draft");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Supplies ─────────────────────────────────────────────────────────────────

const SupplyUpdateBody = z.object({
  name: z.string().optional(),
  category: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  isLowStock: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

function formatSupply(s: typeof suppliesTable.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    category: s.category ?? null,
    notes: s.notes ?? null,
    isLowStock: s.isLowStock,
    lastUpdated: s.lastUpdated.toISOString(),
    sortOrder: s.sortOrder,
  };
}

router.get("/admin/supplies", async (req, res) => {
  try {
    const rows = await db.select().from(suppliesTable).orderBy(asc(suppliesTable.sortOrder), asc(suppliesTable.name));
    res.json(rows.map(formatSupply));
  } catch (err) {
    req.log.error({ err }, "Failed to list supplies");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/supplies", async (req, res) => {
  try {
    const body = z.object({ name: z.string().min(1), category: z.string().nullable().optional(), notes: z.string().nullable().optional() }).parse(req.body);
    const maxRow = await db.select({ max: sql<number>`coalesce(max(${suppliesTable.sortOrder}), -1)` }).from(suppliesTable);
    const nextOrder = (maxRow[0]?.max ?? -1) + 1;
    const [created] = await db.insert(suppliesTable).values({ name: body.name, category: body.category ?? null, notes: body.notes ?? null, sortOrder: nextOrder }).returning();
    res.status(201).json(formatSupply(created));
  } catch (err) {
    req.log.error({ err }, "Failed to create supply");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/supplies/reorder", async (req, res) => {
  try {
    const { orderedIds } = z.object({ orderedIds: z.array(z.string().uuid()) }).parse(req.body);
    await Promise.all(orderedIds.map((id, index) =>
      db.update(suppliesTable).set({ sortOrder: index }).where(eq(suppliesTable.id, id))
    ));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to reorder supplies");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/supplies/:id", async (req, res) => {
  try {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = SupplyUpdateBody.parse(req.body);
    const updates: Partial<typeof suppliesTable.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.category !== undefined) updates.category = body.category;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.isLowStock !== undefined) updates.isLowStock = body.isLowStock;
    if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
    updates.lastUpdated = new Date();
    const [updated] = await db.update(suppliesTable).set(updates).where(eq(suppliesTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(formatSupply(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to update supply");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/supplies/:id", async (req, res) => {
  try {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    await db.delete(suppliesTable).where(eq(suppliesTable.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete supply");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/bookings/:id/vehicle — create a vehicle and link it to the booking
router.post("/admin/bookings/:id/vehicle", async (req, res) => {
  try {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({
      type: z.enum(["car", "suv", "truck", "van"]),
      year: z.number().int().nullable().optional(),
      make: z.string().nullable().optional(),
      model: z.string().nullable().optional(),
      colour: z.string().nullable().optional(),
      licensePlate: z.string().nullable().optional(),
    }).parse(req.body);

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const [vehicle] = await db.insert(vehiclesTable).values({
      customerId: booking.customerId ?? undefined,
      type: body.type,
      year: body.year ?? null,
      make: body.make ?? null,
      model: body.model ?? null,
      colour: body.colour ?? null,
      licensePlate: body.licensePlate ?? null,
    }).returning();

    await db.update(bookingsTable).set({ vehicleId: vehicle.id }).where(eq(bookingsTable.id, id));

    res.status(201).json(formatVehicle(vehicle));
  } catch (err) {
    req.log.error({ err }, "Failed to create and link vehicle");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/vehicles/:id — update vehicle fields
router.patch("/admin/vehicles/:id", async (req, res) => {
  try {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({
      type: z.enum(["car", "suv", "truck", "van"]).optional(),
      year: z.number().int().nullable().optional(),
      make: z.string().nullable().optional(),
      model: z.string().nullable().optional(),
      colour: z.string().nullable().optional(),
      licensePlate: z.string().nullable().optional(),
    }).parse(req.body);

    const updates: Partial<typeof vehiclesTable.$inferInsert> = {};
    if (body.type !== undefined) updates.type = body.type;
    if (body.year !== undefined) updates.year = body.year;
    if (body.make !== undefined) updates.make = body.make;
    if (body.model !== undefined) updates.model = body.model;
    if (body.colour !== undefined) updates.colour = body.colour;
    if (body.licensePlate !== undefined) updates.licensePlate = body.licensePlate;

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No fields to update" });

    const [updated] = await db
      .update(vehiclesTable)
      .set(updates)
      .where(eq(vehiclesTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Vehicle not found" });
    res.json(formatVehicle(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to update vehicle");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
