import { Router } from "express";
import { z } from "zod";
import { getAvailableSlots, getNextAvailableSlots } from "../lib/googleCalendar";

const router = Router();

const AvailabilityQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  duration: z.coerce.number().min(0.25).max(48).default(2),
});

const NextSlotsQuery = z.object({
  duration: z.coerce.number().min(0.25).max(48).default(2),
  count: z.coerce.number().min(1).max(10).default(3),
});

// GET /api/calendar/availability?date=YYYY-MM-DD&duration=<hours>
router.get("/calendar/availability", async (req, res) => {
  const parsed = AvailabilityQuery.safeParse(req.query);
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

// GET /api/calendar/next-slots?duration=<hours>&count=<n>
// Returns the next N available booking slots across upcoming days.
router.get("/calendar/next-slots", async (req, res) => {
  const parsed = NextSlotsQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { duration, count } = parsed.data;

  try {
    const slots = await getNextAvailableSlots(duration, count);
    res.json({ duration, count, slots });
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch next available slots");
    res.status(502).json({ error: "Failed to fetch next available slots" });
  }
});

export default router;
