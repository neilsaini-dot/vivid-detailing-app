import { Router } from "express";
import { db } from "@workspace/db";
import { servicesTable, servicePricesTable, addOnsTable, addOnPricesTable } from "@workspace/db";
import { calculateServicePrice, HST_RATE } from "../lib/pricing";
import { CalculatePriceBody } from "@workspace/api-zod";

const router = Router();

// POST /api/pricing/calculate
router.post("/pricing/calculate", async (req, res) => {
  try {
    const body = CalculatePriceBody.parse(req.body);
    const { vehicleType, serviceIds, addOnIds } = body;

    const lineItems: Array<{
      id: string;
      name: string;
      type: "service" | "addon" | "promo";
      price: number | null;
      isQuoteBased: boolean;
    }> = [];

    // Calculate service prices
    if (serviceIds.length > 0) {
      const services = await db.select().from(servicesTable);
      const prices = await db.select().from(servicePricesTable);

      for (const sid of serviceIds) {
        const service = services.find((s) => s.id === sid);
        if (!service) continue;

        const svcPrices = prices.filter((p) => p.serviceId === sid);
        const result = calculateServicePrice(
          { pricingRule: service.pricingRule, basePrice: service.basePrice, prices: svcPrices },
          vehicleType as any
        );

        lineItems.push({
          id: service.id,
          name: service.name,
          type: "service",
          price: typeof result === "number" ? result : null,
          isQuoteBased: result === "quote",
        });
      }
    }

    // Calculate add-on prices
    if (addOnIds.length > 0) {
      const addOns = await db.select().from(addOnsTable);
      const prices = await db.select().from(addOnPricesTable);

      for (const aid of addOnIds) {
        const addOn = addOns.find((a) => a.id === aid);
        if (!addOn) continue;

        const addonPrices = prices.filter((p) => p.addOnId === aid);
        const entry = addonPrices.find((p) => p.vehicleType === vehicleType);
        const price = entry ? Number(entry.price) : null;

        lineItems.push({
          id: addOn.id,
          name: addOn.name,
          type: "addon",
          price,
          isQuoteBased: false,
        });
      }
    }

    const hasQuoteItems = lineItems.some((li) => li.isQuoteBased);
    const subtotal = lineItems.reduce((sum, li) => sum + (li.price ?? 0), 0);
    const tax = Math.round(subtotal * HST_RATE * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;

    res.json({ lineItems, subtotal, tax, total, hasQuoteItems });
  } catch (err) {
    req.log.error({ err }, "Failed to calculate price");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
