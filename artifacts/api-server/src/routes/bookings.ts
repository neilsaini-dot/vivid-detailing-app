import { Router } from "express";
import { db } from "@workspace/db";
import {
  bookingsTable,
  bookingItemsTable,
  customersTable,
  vehiclesTable,
  servicesTable,
  servicePricesTable,
  addOnsTable,
  addOnPricesTable,
  seasonalPromosTable,
  loyaltyActivityTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateBookingBody,
  GetBookingParams,
  UpdateBookingParams,
  UpdateBookingBody,
  AbandonBookingParams,
  AbandonBookingBody,
} from "@workspace/api-zod";
import { calculateServicePrice, HST_RATE, getLoyaltyTier } from "../lib/pricing";
import { sendGhlWebhook, sendGhlBookingConfirmed } from "../lib/ghl";
import { createCalendarEvent } from "../lib/googleCalendar";
import { formatCustomer, formatVehicle, formatBooking } from "./customers";

const router = Router();

// POST /api/bookings
router.post("/bookings", async (req, res) => {
  try {
    const body = CreateBookingBody.parse(req.body);

    // Upsert customer — link to existing lead if ID provided
    let customer: any;
    if (body.existingCustomerId) {
      const [updated] = await db
        .update(customersTable)
        .set({ name: body.customer.name, email: body.customer.email, phone: body.customer.phone })
        .where(eq(customersTable.id, body.existingCustomerId))
        .returning();
      customer = updated;
    }
    if (!customer) {
      const existing = await db
        .select()
        .from(customersTable)
        .where(eq(customersTable.email, body.customer.email))
        .limit(1);
      if (existing.length > 0) {
        const [updated] = await db
          .update(customersTable)
          .set({ name: body.customer.name, phone: body.customer.phone })
          .where(eq(customersTable.id, existing[0].id))
          .returning();
        customer = updated;
      } else {
        const [created] = await db
          .insert(customersTable)
          .values({
            name: body.customer.name,
            email: body.customer.email,
            phone: body.customer.phone,
          })
          .returning();
        customer = created;
      }
    }

    // Create vehicle
    const [vehicle] = await db
      .insert(vehiclesTable)
      .values({
        customerId: customer.id,
        type: body.vehicle.type,
        year: body.vehicle.year ?? null,
        make: body.vehicle.make ?? null,
        model: body.vehicle.model ?? null,
        colour: body.vehicle.colour ?? null,
        licensePlate: body.vehicle.licensePlate ?? null,
        notes: body.vehicle.notes ?? null,
      })
      .returning();

    // Build booking items
    const items: Array<{
      itemType: "service" | "addon" | "quote" | "promo";
      itemName: string;
      unitPrice: string | null;
      quantity: number;
      isQuoteBased: boolean;
    }> = [];

    const services = await db.select().from(servicesTable);
    const servicePrices = await db.select().from(servicePricesTable);
    const addOns = await db.select().from(addOnsTable);
    const addOnPrices = await db.select().from(addOnPricesTable);
    const promos = await db.select().from(seasonalPromosTable);

    for (const sid of body.serviceIds) {
      const service = services.find((s) => s.id === sid);
      if (!service) continue;
      const svcPrices = servicePrices.filter((p) => p.serviceId === sid);
      const priceResult = calculateServicePrice(
        { pricingRule: service.pricingRule, basePrice: service.basePrice, prices: svcPrices },
        body.vehicle.type as any
      );
      items.push({
        itemType: priceResult === "quote" ? "quote" : "service",
        itemName: service.name,
        unitPrice: typeof priceResult === "number" ? String(priceResult) : null,
        quantity: 1,
        isQuoteBased: priceResult === "quote",
      });
    }

    for (const aid of body.addOnIds) {
      const addOn = addOns.find((a) => a.id === aid);
      if (!addOn) continue;
      const entry = addOnPrices.find(
        (p) => p.addOnId === aid && p.vehicleType === body.vehicle.type
      );
      items.push({
        itemType: "addon",
        itemName: addOn.name,
        unitPrice: entry ? entry.price : null,
        quantity: 1,
        isQuoteBased: false,
      });
    }

    for (const pid of body.promoIds ?? []) {
      const promo = promos.find((p) => p.id === pid);
      if (!promo) continue;
      items.push({
        itemType: "promo",
        itemName: promo.name,
        unitPrice: promo.basePrice,
        quantity: 1,
        isQuoteBased: false,
      });
    }

    const subtotal = items.reduce((s, i) => s + Number(i.unitPrice ?? 0), 0);
    const bundleDiscount = body.bundleDiscount ?? 0;
    const discountedSubtotal = Math.max(0, subtotal - bundleDiscount);
    const total = Math.round(discountedSubtotal * (1 + HST_RATE) * 100) / 100;

    // Create booking
    const [booking] = await db
      .insert(bookingsTable)
      .values({
        customerId: customer.id,
        vehicleId: vehicle.id,
        status: "pending",
        appointmentAt: body.appointmentAt ? new Date(body.appointmentAt) : null,
        totalEstimate: String(body.totalEstimate ?? total),
        notes: body.notes ?? null,
      })
      .returning();

    // Insert items
    if (items.length > 0) {
      await db.insert(bookingItemsTable).values(
        items.map((i) => ({ ...i, bookingId: booking.id }))
      );
    }

    // Record loyalty
    if (total > 0) {
      const tier = getLoyaltyTier(total);
      await db.insert(loyaltyActivityTable).values({
        customerId: customer.id,
        bookingId: booking.id,
        spendAmount: String(total),
        tierAtTime: tier,
      });
    }

    // Build shared context for async side-effects
    const serviceNames = body.serviceIds
      .map((id) => services.find((s) => s.id === id)?.name ?? id)
      .filter(Boolean);
    const addOnNames = body.addOnIds
      .map((id) => addOns.find((a) => a.id === id)?.name ?? id)
      .filter(Boolean);
    const hasQuote = items.some((i) => i.isQuoteBased);

    const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model]
      .filter(Boolean)
      .join(" ") || vehicle.type;

    const [firstName, ...rest] = (customer.name ?? "Guest").trim().split(" ");
    const lastName = rest.join(" ") || "";

    const opportunityTitle = `${serviceNames[0] ?? "Detailing"} - ${vehicleLabel}`;

    // Bundle discount context
    const bundleAddonNames = (body.bundleAddonIds ?? [])
      .map((id) => addOns.find((a) => a.id === id)?.name ?? id)
      .filter(Boolean);
    const hasBundleDeal = bundleDiscount > 0 && bundleAddonNames.length > 0;

    const calendarDescription = [
      `Customer: ${customer.name ?? ""} | ${customer.phone ?? ""} | ${customer.email ?? ""}`,
      `Vehicle: ${vehicleLabel}`,
      `Services: ${serviceNames.join(", ") || "N/A"}`,
      addOnNames.length > 0 ? `Add-ons: ${addOnNames.join(", ")}` : null,
      hasBundleDeal
        ? `🏷 Bundle Deal (25% off): ${bundleAddonNames.join(", ")} — saved $${bundleDiscount.toFixed(2)} pre-tax ($${(bundleDiscount * (1 + HST_RATE)).toFixed(2)} incl. HST)`
        : null,
      `Estimated Total (incl. HST): $${total.toFixed(2)}`,
      body.notes ? `Notes: ${body.notes}` : null,
      `Booking ID: ${booking.id}`,
    ]
      .filter(Boolean)
      .join("\n");

    // Rough duration estimate: 2 h base + 1 h per additional service, cap 6 h
    const durationHours = Math.min(2 + Math.max(0, serviceNames.length - 1), 6);

    // Fire GHL booking-confirmed webhook (creates contact + marks opportunity won)
    sendGhlBookingConfirmed({
      event: "booking_confirmed",
      contact: {
        firstName,
        lastName,
        email: customer.email ?? "",
        phone: customer.phone ?? "",
        tags: ["Booking", "Vivid Detailing", ...serviceNames],
      },
      opportunity: {
        title: hasBundleDeal ? `${opportunityTitle} 🏷 Bundle Deal` : opportunityTitle,
        status: "won",
        monetaryValue: total,
        pipelineStageName: "Won",
        notes: calendarDescription,
      },
      booking: {
        id: booking.id,
        services: serviceNames,
        addons: addOnNames,
        vehicle: vehicleLabel,
        appointment_at: body.appointmentAt ?? null,
        total_estimate: total,
        is_quote_based: hasQuote,
        notes: body.notes ?? null,
        ...(hasBundleDeal && {
          bundle_addons: bundleAddonNames,
          bundle_discount_pretax: bundleDiscount,
          bundle_discount_total: Math.round(bundleDiscount * (1 + HST_RATE) * 100) / 100,
        }),
      },
      source: "vivid-app",
    }).catch(() => {});

    // Create Google Calendar event (non-blocking)
    if (body.appointmentAt) {
      createCalendarEvent({
        summary: `Vivid Detailing - ${customer.name ?? "Customer"} - ${serviceNames.join(", ") || "Appointment"}`,
        description: calendarDescription,
        startIso: body.appointmentAt,
        durationHours,
      }).catch(() => {});
    }

    const savedItems = await db
      .select()
      .from(bookingItemsTable)
      .where(eq(bookingItemsTable.bookingId, booking.id));

    res.status(201).json(
      formatBooking({
        ...booking,
        items: savedItems,
        customer,
        vehicle,
      })
    );
  } catch (err) {
    req.log.error({ err }, "Failed to create booking");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/bookings/:id
router.get("/bookings/:id", async (req, res) => {
  try {
    const { id } = GetBookingParams.parse(req.params);
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

    res.json(formatBooking({ ...booking, items, customer, vehicle }));
  } catch (err) {
    req.log.error({ err }, "Failed to get booking");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/bookings/:id
router.patch("/bookings/:id", async (req, res) => {
  try {
    const { id } = UpdateBookingParams.parse(req.params);
    const body = UpdateBookingBody.parse(req.body);

    const updates: Partial<typeof bookingsTable.$inferInsert> = {};
    if (body.status) updates.status = body.status;
    if (body.appointmentAt !== undefined)
      updates.appointmentAt = body.appointmentAt ? new Date(body.appointmentAt) : null;
    if (body.notes !== undefined) updates.notes = body.notes ?? null;
    if (body.depositPaid !== undefined) updates.depositPaid = body.depositPaid;

    const [updated] = await db
      .update(bookingsTable)
      .set(updates)
      .where(eq(bookingsTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Not found" });

    const items = await db
      .select()
      .from(bookingItemsTable)
      .where(eq(bookingItemsTable.bookingId, id));

    res.json(formatBooking({ ...updated, items, customer: null, vehicle: null }));
  } catch (err) {
    req.log.error({ err }, "Failed to update booking");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/bookings/:id/abandon
router.post("/bookings/:id/abandon", async (req, res) => {
  try {
    const { id } = AbandonBookingParams.parse(req.params);
    const { lastStep } = AbandonBookingBody.parse(req.body);

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, id));
    if (!booking) return res.status(404).json({ error: "Not found" });

    const customer = booking.customerId
      ? (await db.select().from(customersTable).where(eq(customersTable.id, booking.customerId)))[0]
      : null;
    const vehicle = booking.vehicleId
      ? (await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, booking.vehicleId)))[0]
      : null;

    sendGhlWebhook({
      event: "booking_abandoned",
      customer: {
        name: customer?.name ?? "",
        email: customer?.email ?? "",
        phone: customer?.phone ?? "",
      },
      vehicle: { type: vehicle?.type ?? "car" },
      booking: {
        service_category: "",
        package: "",
        addons: [],
        total_estimate: Number(booking.totalEstimate ?? 0),
        appointment_at: booking.appointmentAt?.toISOString() ?? null,
        notes: booking.notes ?? null,
        is_quote_based: false,
        last_step: lastStep,
      },
      tags: ["Abandoned"],
      source: "vivid-app",
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to abandon booking");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
