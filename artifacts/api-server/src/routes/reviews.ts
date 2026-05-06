import { Router } from "express";
import { db } from "@workspace/db";
import { reviewsTable, bookingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const GOOGLE_REVIEW_URL = process.env.GOOGLE_REVIEW_URL;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

const router = Router();

// POST /api/reviews — submit a customer review (no auth required)
router.post("/reviews", async (req, res) => {
  try {
    const { bookingId, rating, feedback } = req.body as {
      bookingId: string;
      rating: number;
      feedback?: string | null;
    };

    if (!bookingId || !rating) {
      return res.status(400).json({ error: "bookingId and rating required" });
    }
    if (!isUuid(bookingId)) {
      return res.status(400).json({ error: "bookingId must be a valid UUID" });
    }
    if (typeof rating !== "number" || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "rating must be between 1 and 5" });
    }

    // Check for existing review
    const [existing] = await db
      .select({ id: reviewsTable.id })
      .from(reviewsTable)
      .where(eq(reviewsTable.bookingId, bookingId))
      .limit(1);
    if (existing) {
      return res.status(200).json({ success: false, alreadySubmitted: true, redirectUrl: null });
    }

    // Look up booking to link customer
    const [booking] = await db
      .select({ customerId: bookingsTable.customerId })
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId))
      .limit(1);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const isHighRating = rating >= 4;
    const redirectUrl = isHighRating && GOOGLE_REVIEW_URL ? GOOGLE_REVIEW_URL : null;

    await db.insert(reviewsTable).values({
      bookingId,
      customerId: booking.customerId ?? undefined,
      rating,
      feedback: feedback ?? null,
      redirectedToGoogle: isHighRating && !!GOOGLE_REVIEW_URL,
    });

    res.status(201).json({ success: true, alreadySubmitted: false, redirectUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err, message }, "Failed to submit review");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reviews/check?bookingId=xxx — check if a review already exists
router.get("/reviews/check", async (req, res) => {
  try {
    const bookingId = req.query.bookingId as string;
    if (!bookingId) {
      return res.status(400).json({ error: "bookingId required" });
    }
    if (!isUuid(bookingId)) {
      return res.status(400).json({ error: "bookingId must be a valid UUID" });
    }
    const [existing] = await db
      .select({ id: reviewsTable.id })
      .from(reviewsTable)
      .where(eq(reviewsTable.bookingId, bookingId))
      .limit(1);
    res.json({ exists: !!existing });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err, message }, "Failed to check review");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
