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
import { eq, desc, sum } from "drizzle-orm";
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

// POST /api/leads — partial lead capture (name + phone, no email required)
router.post("/leads", async (req, res) => {
  try {
    const body = CaptureLeadBody.parse(req.body);

    const [customer] = await db
      .insert(customersTable)
      .values({ name: body.name, phone: body.phone })
      .returning();

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

    const vehicles = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.customerId, id));

    const bookings = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.customerId, id))
      .orderBy(desc(bookingsTable.createdAt));

    const now = new Date();
    const upcomingBooking = bookings.find(
      (b) => b.appointmentAt && new Date(b.appointmentAt) > now && b.status !== "cancelled"
    ) ?? null;

    const recentBookings = bookings.slice(0, 5);

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
        const items = await db
          .select()
          .from(bookingItemsTable)
          .where(eq(bookingItemsTable.bookingId, b.id));
        return { ...b, items, customer: null, vehicle: null };
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
    customer: b.customer ? formatCustomer(b.customer) : null,
    vehicle: b.vehicle ? formatVehicle(b.vehicle) : null,
  };
}

export default router;
