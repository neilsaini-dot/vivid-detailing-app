// Storage routes — backed by Supabase Storage (replaces Replit GCS sidecar).
// Upload flow: client requests a signed URL, PUTs directly to Supabase CDN.
// Serving: photos are public; the stored publicUrl is used directly as <img src>.
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { bookingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createSignedUploadUrl } from "../lib/supabaseStorage";

const RequestUploadUrlBody = z.object({
  name: z.string(),
  size: z.number().optional(),
  contentType: z.string().optional(),
  bookingId: z.string().uuid().optional(),
  photoType: z.enum(["before", "after"]).optional(),
});

const router: IRouter = Router();

/**
 * POST /storage/uploads/request-url
 *
 * Returns a Supabase signed upload URL. The client PUTs the file directly to
 * Supabase CDN. The returned `objectPath` is the full public URL — store it in
 * the DB and use it directly as an <img src>.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { name, size, contentType, bookingId, photoType } = parsed.data;

  try {
    // Resolve customerId from bookingId when provided
    let customerId = "unknown";
    if (bookingId) {
      const [booking] = await db
        .select({ customerId: bookingsTable.customerId })
        .from(bookingsTable)
        .where(eq(bookingsTable.id, bookingId))
        .limit(1);
      if (booking?.customerId) customerId = booking.customerId;
    }

    const type = photoType ?? "before";
    const result = await createSignedUploadUrl(customerId, bookingId ?? "unknown", type, name);

    res.json({
      uploadURL: result.signedUrl,
      objectPath: result.publicUrl,   // full public URL — use directly as <img src>
      metadata: { name, size, contentType },
    });
  } catch (error) {
    req.log.error({ err: error }, "Error generating Supabase upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/objects/* — legacy compatibility shim.
 * Old photos stored as "/objects/..." paths will 404 here; new photos use
 * direct Supabase public URLs and never hit this route.
 */
router.get("/storage/objects/*path", (_req: Request, res: Response) => {
  res.status(404).json({ error: "This photo was stored before the Supabase migration. Please re-upload." });
});

export default router;
