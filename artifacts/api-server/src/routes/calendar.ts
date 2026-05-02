import { Router } from "express";
import { z } from "zod";
import { getAvailableSlots } from "../lib/googleCalendar";

const router = Router();

const QuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  duration: z.coerce.number().min(0.25).max(48).default(2),
});

// GET /api/calendar/availability?date=YYYY-MM-DD&duration=<hours>
router.get("/calendar/availability", async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { date, duration } = parsed.data;

  try {
    const slots = await getAvailableSlots(date, duration);
    res.json({ date, duration, slots });
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch calendar availability");
    res.status(502).json({ error: "Failed to fetch calendar availability" });
  }
});

export default router;
