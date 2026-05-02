import { Router } from "express";
import { db } from "@workspace/db";
import { quoteRequestsTable, customersTable, vehiclesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateQuoteRequestBody } from "@workspace/api-zod";
import { sendGhlWebhook } from "../lib/ghl";

const router = Router();

// POST /api/quotes
router.post("/quotes", async (req, res) => {
  try {
    const body = CreateQuoteRequestBody.parse(req.body);

    // Upsert customer
    let customer: any = null;
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
      })
      .returning();

    const [quote] = await db
      .insert(quoteRequestsTable)
      .values({
        customerId: customer.id,
        vehicleId: vehicle.id,
        serviceType: body.serviceType,
        coverageOption: body.coverageOption ?? null,
        notes: body.notes ?? null,
        photoUrls: body.photoUrls ?? [],
        status: "pending",
      })
      .returning();

    // Fire GHL webhook
    const event = body.serviceType.toLowerCase().includes("ppf")
      ? "ppf_quote_request"
      : "ppf_quote_request";

    sendGhlWebhook({
      event,
      customer: {
        name: customer.name ?? "",
        email: customer.email ?? "",
        phone: customer.phone ?? "",
      },
      vehicle: {
        type: vehicle.type,
        year: vehicle.year?.toString() ?? "",
        make: vehicle.make ?? "",
        model: vehicle.model ?? "",
      },
      booking: {
        service_category: "quote",
        package: body.serviceType,
        addons: [],
        total_estimate: 0,
        appointment_at: null,
        notes: body.notes ?? null,
        is_quote_based: true,
        coverage_option: body.coverageOption ?? undefined,
      },
      tags: ["PPF Quote", "High Value Lead"],
      source: "vivid-app",
    }).catch(() => {});

    res.status(201).json({
      id: quote.id,
      customerId: quote.customerId,
      vehicleId: quote.vehicleId,
      serviceType: quote.serviceType,
      coverageOption: quote.coverageOption,
      notes: quote.notes,
      photoUrls: quote.photoUrls,
      status: quote.status,
      createdAt: quote.createdAt?.toISOString() ?? new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create quote");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
