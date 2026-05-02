import { Router } from "express";
import { db } from "@workspace/db";
import { servicesTable, servicePricesTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import {
  ListServicesQueryParams,
  GetServiceParams,
} from "@workspace/api-zod";

const router = Router();

async function getServicesWithPrices(where?: Parameters<typeof db.select>[0]) {
  const services = await db
    .select()
    .from(servicesTable)
    .orderBy(asc(servicesTable.sortOrder));

  const prices = await db.select().from(servicePricesTable);

  return services.map((s) => ({
    ...s,
    prices: prices.filter((p) => p.serviceId === s.id),
  }));
}

// GET /api/services
router.get("/services", async (req, res) => {
  try {
    const query = ListServicesQueryParams.parse(req.query);
    let allServices = await getServicesWithPrices();

    // Filter to active only
    allServices = allServices.filter((s) => s.isActive);

    if (query.category) {
      allServices = allServices.filter((s) => s.category === query.category);
    }

    if (query.goal) {
      const goalByCategory: Record<string, string[]> = {
        clean:   ["detailing"],
        protect: ["ceramic", "seasonal"],
        tint:    ["tint"],
        quote:   ["paint_correction", "ppf"],
      };
      const goalByName: Record<string, string[]> = {
        paint: ["Vivid Glow", "Paint Correction", "Vivid Ceramic Guard", "Vivid Ceramic Elite Guard"],
      };
      if (goalByCategory[query.goal]) {
        const cats = goalByCategory[query.goal];
        allServices = allServices.filter((s) => cats.includes(s.category));
      } else if (goalByName[query.goal]) {
        const names = goalByName[query.goal];
        allServices = allServices.filter((s) => names.includes(s.name));
      }
    }

    res.json(allServices.map(formatService));
  } catch (err) {
    req.log.error({ err }, "Failed to list services");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/services/featured
router.get("/services/featured", async (req, res) => {
  try {
    const all = await getServicesWithPrices();
    const featured = all.filter((s) => s.isActive && (s.isSeasonal || s.category === "seasonal"));
    res.json(featured.map(formatService));
  } catch (err) {
    req.log.error({ err }, "Failed to list featured services");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/services/:id
router.get("/services/:id", async (req, res) => {
  try {
    const { id } = GetServiceParams.parse(req.params);
    const [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, id));
    if (!service) return res.status(404).json({ error: "Not found" });

    const prices = await db
      .select()
      .from(servicePricesTable)
      .where(eq(servicePricesTable.serviceId, id));

    res.json(formatService({ ...service, prices }));
  } catch (err) {
    req.log.error({ err }, "Failed to get service");
    res.status(500).json({ error: "Internal server error" });
  }
});

function formatService(s: any) {
  return {
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
    prices: (s.prices ?? []).map((p: any) => ({
      vehicleType: p.vehicleType,
      price: Number(p.price),
    })),
  };
}

export default router;
