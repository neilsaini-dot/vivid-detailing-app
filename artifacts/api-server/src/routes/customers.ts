import { Router } from "express";
import { db } from "@workspace/db";
import {
  customersTable,
  vehiclesTable,
  bookingsTable,
  bookingItemsTable,
  loyaltyActivityTable,
  serviceHistoryTable,
} from "@workspace/db";
import { eq, desc, sum, or, and, inArray } from "drizzle-orm";
import {
  CaptureLeadBody,
  UpsertCustomerBody,
  GetCustomerParams,
  GetCustomerVehiclesParams,
  GetCustomerBookingsParams,
  GetCustomerLoyaltyParams,
  GetCustomerDashboardParams,
} from "@workspace/api-zod";
import {
  getLoyaltyTier,
  getNextTier,
  getLoyaltyProgress,
} from "../lib/pricing";
import { sendGhlLeadWebhook } from "../lib/ghl";

const router = Router();

// Normalize phone to digits-only for consistent dedup lookups
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

// POST /api/leads — partial lead capture (name + phone, no email required)
router.post("/leads", async (req, res) => {
  try {
    const body = CaptureLeadBody.parse(req.body);

    // Reuse existing customer matched by phone so returning customers keep
    // their loyalty history and we never create orphaned lead records.
    let customer: typeof customersTable.$inferSelect | undefined;
    if (body.phone) {
      const normalized = normalizePhone(body.phone);
      const all = await db.select().from(customersTable);
      const existing = all.find(c => c.phone && normalizePhone(c.phone) === normalized);
      if (existing) {
        const [updated] = await db
          .update(customersTable)
          .set({ name: body.name })
          .where(eq(customersTable.id, existing.id))
          .returning();
        customer = updated;
      }
    }
    if (!customer) {
      const [created] = await db
        .insert(customersTable)
        .values({ name: body.name, phone: body.phone })
        .returning();
      customer = created;
    }

    req.log.info({ customerId: customer.id }, "Lead captured");

    // Fire GHL webhook async — non-blocking
    sendGhlLeadWebhook({
      event: "lead_captured",
      lead_captured: true,
      customer: { id: customer.id, name: customer.name ?? "", phone: customer.phone ?? "" },
      tags: ["Lead", "Partial"],
      source: "vivid-app",
    }).catch(() => {});

    res.status(201).json(formatCustomer(customer));
  } catch (err) {
    req.log.error({ err }, "Failed to capture lead");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/customers
router.post("/customers", async (req, res) => {
  try {
    const body = UpsertCustomerBody.parse(req.body);

    // Upsert by email
    const existing = await db
      .select()
      .from(customersTable)
      .where(eq(customersTable.email, body.email))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(customersTable)
        .set({ name: body.name, phone: body.phone })
        .where(eq(customersTable.id, existing[0].id))
        .returning();
      return res.json(formatCustomer(updated));
    }

    const [customer] = await db
      .insert(customersTable)
      .values({ name: body.name, email: body.email, phone: body.phone })
      .returning();

    res.json(formatCustomer(customer));
  } catch (err) {
    req.log.error({ err }, "Failed to upsert customer");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/customers/:id
router.get("/customers/:id", async (req, res) => {
  try {
    const { id } = GetCustomerParams.parse(req.params);
    const [customer] = await db
      .select()
      .from(customersTable)
      .where(eq(customersTable.id, id));
    if (!customer) return res.status(404).json({ error: "Not found" });
    res.json(formatCustomer(customer));
  } catch (err) {
    req.log.error({ err }, "Failed to get customer");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/customers/:id/vehicles
router.get("/customers/:id/vehicles", async (req, res) => {
  try {
    const { id } = GetCustomerVehiclesParams.parse(req.params);
    const vehicles = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.customerId, id))
      .orderBy(desc(vehiclesTable.createdAt));
    res.json(vehicles.map(formatVehicle));
  } catch (err) {
    req.log.error({ err }, "Failed to get customer vehicles");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/customers/:id/bookings
router.get("/customers/:id/bookings", async (req, res) => {
  try {
    const { id } = GetCustomerBookingsParams.parse(req.params);
    const bookings = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.customerId, id))
      .orderBy(desc(bookingsTable.createdAt));

    const withItems = await Promise.all(
      bookings.map(async (b) => {
        const items = await db
          .select()
          .from(bookingItemsTable)
          .where(eq(bookingItemsTable.bookingId, b.id));
        return { ...b, items, customer: null, vehicle: null };
      })
    );

    res.json(withItems.map(formatBooking));
  } catch (err) {
    req.log.error({ err }, "Failed to get customer bookings");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/customers/:id/loyalty
router.get("/customers/:id/loyalty", async (req, res) => {
  try {
    const { id } = GetCustomerLoyaltyParams.parse(req.params);

    const spendResult = await db
      .select({ total: sum(loyaltyActivityTable.spendAmount) })
      .from(loyaltyActivityTable)
      .where(eq(loyaltyActivityTable.customerId, id));

    // Also sum from completed bookings
    const bookingSpend = await db
      .select({ total: sum(bookingsTable.totalEstimate) })
      .from(bookingsTable)
      .where(eq(bookingsTable.customerId, id));

    const lifetimeSpend = Number(bookingSpend[0]?.total ?? 0);
    const tier = getLoyaltyTier(lifetimeSpend);
    const { name: nextTierName, threshold: nextTierThreshold } = getNextTier(tier);
    const progressPercent = getLoyaltyProgress(lifetimeSpend, tier);

    res.json({ tier, lifetimeSpend, nextTierName, nextTierThreshold, progressPercent });
  } catch (err) {
    req.log.error({ err }, "Failed to get loyalty");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/customers/:id/dashboard
router.get("/customers/:id/dashboard", async (req, res) => {
  try {
    const { id } = GetCustomerDashboardParams.parse(req.params);

    const [customer] = await db
      .select()
      .from(customersTable)
      .where(eq(customersTable.id, id));
    if (!customer) return res.status(404).json({ error: "Not found" });

    // Find all sibling customer records that share this customer's email or phone.
    // This makes the dashboard resilient to duplicate records that haven't been
    // merged yet (e.g. production DB after a migration).
    const siblingIds: string[] = [id];
    if (customer.email || customer.phone) {
      const conditions = [];
      if (customer.email) conditions.push(eq(customersTable.email, customer.email));
      if (customer.phone) conditions.push(eq(customersTable.phone, customer.phone));
      const siblings = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(or(...conditions));
      for (const s of siblings) {
        if (!siblingIds.includes(s.id)) siblingIds.push(s.id);
      }
    }

    // Pull vehicles from ALL sibling records so no vehicle is hidden behind a
    // duplicate customer ID.
    const allVehicles = await db
      .select()
      .from(vehiclesTable)
      .where(inArray(vehiclesTable.customerId, siblingIds))
      .orderBy(desc(vehiclesTable.createdAt));

    // Deduplicate vehicles: keep the most-recent record per year+make+model combo.
    // Only dedup when there is enough data to form a meaningful key (at least a
    // non-empty make). Records with no make keep their own ID as the key so they
    // are never incorrectly collapsed together.
    const seenVehicles = new Set<string>();
    const vehicles = allVehicles.filter((v) => {
      const make = (v.make ?? "").trim().toLowerCase();
      const key = make
        ? `${String(v.year ?? "")}|${make}|${(v.model ?? "").trim().toLowerCase()}`
        : `__id:${v.id}`;
      if (seenVehicles.has(key)) return false;
      seenVehicles.add(key);
      return true;
    });

    // Pull bookings from ALL sibling records too
    const allBookingCondition = siblingIds.length === 1
      ? eq(bookingsTable.customerId, id)
      : inArray(bookingsTable.customerId, siblingIds);

    const bookings = await db
      .select()
      .from(bookingsTable)
      .where(allBookingCondition)
      .orderBy(desc(bookingsTable.createdAt));

    const now = new Date();
    const upcomingBooking = bookings.find(
      (b) => b.appointmentAt && new Date(b.appointmentAt) > now && b.status !== "cancelled"
    ) ?? null;

    // Show ALL bookings in service history — no arbitrary cap
    const recentBookings = bookings;

    const bookingSpend = await db
      .select({ total: sum(bookingsTable.totalEstimate) })
      .from(bookingsTable)
      .where(eq(bookingsTable.customerId, id));
    const lifetimeSpend = Number(bookingSpend[0]?.total ?? 0);
    const tier = getLoyaltyTier(lifetimeSpend);
    const { name: nextTierName, threshold: nextTierThreshold } = getNextTier(tier);
    const progressPercent = getLoyaltyProgress(lifetimeSpend, tier);
    const loyalty = { tier, lifetimeSpend, nextTierName, nextTierThreshold, progressPercent };

    // Last condition score from service history
    const history = await db
      .select()
      .from(serviceHistoryTable)
      .where(eq(serviceHistoryTable.customerId, id))
      .orderBy(desc(serviceHistoryTable.completedAt))
      .limit(1);

    const conditionScore = history[0]?.conditionScore ?? null;

    const lastCompleted = bookings.find((b) => b.status === "completed");
    const lastCompletedAt = lastCompleted?.appointmentAt?.toISOString() ?? null;

    const daysSince = lastCompletedAt
      ? (now.getTime() - new Date(lastCompletedAt).getTime()) / (1000 * 60 * 60 * 24)
      : null;
    const maintenanceDue = daysSince !== null ? daysSince > 90 : false;

    const withItems = await Promise.all(
      recentBookings.map(async (b) => {
        const [items, [svcHistory]] = await Promise.all([
          db.select().from(bookingItemsTable).where(eq(bookingItemsTable.bookingId, b.id)),
          db.select().from(serviceHistoryTable).where(eq(serviceHistoryTable.bookingId, b.id)).limit(1),
        ]);
        return {
          ...b,
          items,
          customer: null,
          vehicle: null,
          serviceHistory: svcHistory
            ? {
                conditionScore: svcHistory.conditionScore,
                beforePhotoUrls: svcHistory.beforePhotoUrls ?? [],
                afterPhotoUrls: svcHistory.afterPhotoUrls ?? [],
              }
            : null,
        };
      })
    );

    const upcomingWithItems = upcomingBooking
      ? {
          ...upcomingBooking,
          items: await db
            .select()
            .from(bookingItemsTable)
            .where(eq(bookingItemsTable.bookingId, upcomingBooking.id)),
          customer: null,
          vehicle: null,
        }
      : null;

    res.json({
      customer: formatCustomer(customer),
      vehicles: vehicles.map(formatVehicle),
      upcomingBooking: upcomingWithItems ? formatBooking(upcomingWithItems) : null,
      recentBookings: withItems.map(formatBooking),
      loyalty,
      conditionScore,
      maintenanceDue,
      lastCompletedAt,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/customers/:id/vehicles — add a vehicle
router.post("/customers/:id/vehicles", async (req, res) => {
  try {
    const { id } = req.params;
    const { type, year, make, model, colour, licensePlate, notes } = req.body;
    const [vehicle] = await db
      .insert(vehiclesTable)
      .values({ customerId: id, type: type ?? "car", year: year ? Number(year) : null, make, model, colour, licensePlate, notes })
      .returning();
    res.status(201).json(formatVehicle(vehicle));
  } catch (err) {
    req.log.error({ err }, "Failed to create vehicle");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/customers/:id/vehicles/:vehicleId — update a vehicle
router.patch("/customers/:id/vehicles/:vehicleId", async (req, res) => {
  try {
    const { id, vehicleId } = req.params;
    const { type, year, make, model, colour, licensePlate, notes } = req.body;
    const [vehicle] = await db
      .update(vehiclesTable)
      .set({ type, year: year ? Number(year) : undefined, make, model, colour, licensePlate, notes })
      .where(and(eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.customerId as any, id)))
      .returning();
    if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
    res.json(formatVehicle(vehicle));
  } catch (err) {
    req.log.error({ err }, "Failed to update vehicle");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/customers/:id/vehicles/:vehicleId — remove a vehicle
router.delete("/customers/:id/vehicles/:vehicleId", async (req, res) => {
  try {
    const { id, vehicleId } = req.params;
    await db
      .delete(vehiclesTable)
      .where(and(eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.customerId as any, id)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete vehicle");
    res.status(500).json({ error: "Internal server error" });
  }
});

export function formatCustomer(c: any) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    ghlContactId: c.ghlContactId,
    ghlSyncStatus: c.ghlSyncStatus,
    ghlLastSync: c.ghlLastSync?.toISOString() ?? null,
    createdAt: c.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

export function formatVehicle(v: any) {
  return {
    id: v.id,
    customerId: v.customerId,
    type: v.type,
    year: v.year,
    make: v.make,
    model: v.model,
    colour: v.colour,
    licensePlate: v.licensePlate,
    notes: v.notes,
    createdAt: v.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

export function formatBooking(b: any) {
  return {
    id: b.id,
    customerId: b.customerId,
    vehicleId: b.vehicleId,
    status: b.status,
    appointmentAt: b.appointmentAt?.toISOString() ?? null,
    totalEstimate: b.totalEstimate ? Number(b.totalEstimate) : null,
    depositPaid: b.depositPaid,
    notes: b.notes,
    ghlContactId: b.ghlContactId,
    ghlOpportunityId: b.ghlOpportunityId,
    createdAt: b.createdAt?.toISOString() ?? new Date().toISOString(),
    items: (b.items ?? []).map((i: any) => ({
      id: i.id,
      bookingId: i.bookingId,
      itemType: i.itemType,
      itemName: i.itemName,
      unitPrice: i.unitPrice ? Number(i.unitPrice) : null,
      quantity: i.quantity,
      isQuoteBased: i.isQuoteBased,
    })),
    source: b.source ?? "online",
    isManualPriceOverride: b.isManualPriceOverride ?? false,
    createdByAdmin: b.createdByAdmin ?? false,
    estimatedPickupAt: b.estimatedPickupAt?.toISOString() ?? null,
    customer: b.customer ? formatCustomer(b.customer) : null,
    vehicle: b.vehicle ? formatVehicle(b.vehicle) : null,
    serviceHistory: b.serviceHistory ?? null,
  };
}

export default router;
