import { Router } from "express";
import { db } from "@workspace/db";
import { addOnsTable, addOnPricesTable } from "@workspace/db";
import { asc } from "drizzle-orm";
import { ListAddOnsQueryParams } from "@workspace/api-zod";

const router = Router();

// GET /api/add-ons
router.get("/add-ons", async (req, res) => {
  try {
    const query = ListAddOnsQueryParams.parse(req.query);

    let addOns = await db.select().from(addOnsTable).orderBy(asc(addOnsTable.sortOrder));
    addOns = addOns.filter((a) => a.isActive);

    if (query.group) {
      addOns = addOns.filter((a) => a.categoryGroup === query.group);
    }

    const prices = await db.select().from(addOnPricesTable);

    const result = addOns.map((a) => {
      let addonPrices = prices.filter((p) => p.addOnId === a.id);
      if (query.vehicleType) {
        addonPrices = addonPrices.filter((p) => p.vehicleType === query.vehicleType);
      }
      return {
        id: a.id,
        name: a.name,
        categoryGroup: a.categoryGroup,
        isActive: a.isActive,
        showInProtectionStep: a.showInProtectionStep,
        sortOrder: a.sortOrder,
        prices: addonPrices.map((p) => ({
          vehicleType: p.vehicleType,
          price: Number(p.price),
        })),
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to list add-ons");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
