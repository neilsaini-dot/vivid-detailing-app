import { Router } from "express";
import { db } from "@workspace/db";
import { vehiclesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateVehicleBody, GetVehicleParams } from "@workspace/api-zod";
import { formatVehicle } from "./customers";

const router = Router();

// POST /api/vehicles
router.post("/vehicles", async (req, res) => {
  try {
    const body = CreateVehicleBody.parse(req.body);
    const [vehicle] = await db
      .insert(vehiclesTable)
      .values({
        customerId: body.customerId ?? null,
        type: body.type,
        year: body.year ?? null,
        make: body.make ?? null,
        model: body.model ?? null,
        colour: body.colour ?? null,
        licensePlate: body.licensePlate ?? null,
        notes: body.notes ?? null,
      })
      .returning();
    res.status(201).json(formatVehicle(vehicle));
  } catch (err) {
    req.log.error({ err }, "Failed to create vehicle");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/vehicles/:id
router.get("/vehicles/:id", async (req, res) => {
  try {
    const { id } = GetVehicleParams.parse(req.params);
    const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id));
    if (!vehicle) return res.status(404).json({ error: "Not found" });
    res.json(formatVehicle(vehicle));
  } catch (err) {
    req.log.error({ err }, "Failed to get vehicle");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
