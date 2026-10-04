import { Router, type Request, type Response } from "express";
import {
  AdminCheckAiBookingOriginResponse,
  AdminListAiBookingsResponse, AdminSaveAiBookingParams, AdminSaveAiBookingBody, AdminSaveAiBookingResponse,
  AdminConvertAiBookingParams, AdminConvertAiBookingBody, AdminConvertAiBookingResponse,
  AdminResolveAiBookingWebhookParams, AdminResolveAiBookingWebhookBody, AdminResolveAiBookingWebhookResponse,
} from "@workspace/api-zod";
import { AiConversionError, readAiBookings, saveAiBooking, convertAiBooking, resolveAiWebhook } from "../lib/aiBookingConversion";
import { GhlAppointmentApiError, inspectAppointmentLookup } from "../lib/ghlAppointments";
import { db, ghlSpecialAppointmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const defaults = { readAiBookings, saveAiBooking, convertAiBooking, resolveAiWebhook };
function handleError(req: Request, res: Response, cause: unknown) {
  if (cause instanceof AiConversionError || cause instanceof GhlAppointmentApiError) { res.status(cause.status).json({ error: cause.message }); return; }
  const failure = cause as { code?: string; cause?: { code?: string } };
  if (["42P01", "42703"].includes(failure.code ?? "") || ["42P01", "42703"].includes(failure.cause?.code ?? "")) {
    res.status(503).json({ error: "AI conversion setup is required. Run scripts/migrate-ai-booking-conversions.sql in the existing Supabase database." });
    return;
  }
  req.log.error({ errorName: cause instanceof Error ? cause.name : "UnknownError" }, "AI booking conversion failed");
  res.status(500).json({ error: "Could not process AI booking. Refresh and check its conversion status before retrying." });
}

export function createAiBookingsRouter(services: typeof defaults = defaults) {
const router = Router();
router.get("/admin/ai-bookings/:id/origin-check", async (req, res): Promise<void> => {
  const params = AdminSaveAiBookingParams.safeParse(req.params);
  if (!params.success) { res.status(422).json({ error: "Invalid booking ID." }); return; }
  try {
    const [mapping] = await db.select().from(ghlSpecialAppointmentsTable)
      .where(eq(ghlSpecialAppointmentsTable.bookingId, params.data.id));
    if (!mapping) { res.status(404).json({ error: "AI booking not found." }); return; }
    res.json(AdminCheckAiBookingOriginResponse.parse(await inspectAppointmentLookup(mapping)));
  } catch (cause) { handleError(req, res, cause); }
});
router.get("/admin/ai-bookings", async (req, res): Promise<void> => {
  try { res.json(AdminListAiBookingsResponse.parse(await services.readAiBookings())); }
  catch (cause) { handleError(req, res, cause); }
});
router.patch("/admin/ai-bookings/:id", async (req, res): Promise<void> => {
  const params = AdminSaveAiBookingParams.safeParse(req.params);
  const body = AdminSaveAiBookingBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(422).json({ error: "Invalid review details." }); return; }
  try {
    await services.saveAiBooking(params.data.id, body.data);
    res.json(AdminSaveAiBookingResponse.parse((await services.readAiBookings()).find(b => b.id === params.data.id)));
  } catch (cause) { handleError(req, res, cause); }
});
router.post("/admin/ai-bookings/:id/convert", async (req, res): Promise<void> => {
  const params = AdminConvertAiBookingParams.safeParse(req.params);
  const body = AdminConvertAiBookingBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(422).json({ error: "Invalid review details." }); return; }
  try {
    await services.convertAiBooking(params.data.id, body.data);
    res.json(AdminConvertAiBookingResponse.parse((await services.readAiBookings()).find(b => b.id === params.data.id)));
  } catch (cause) { handleError(req, res, cause); }
});
router.post("/admin/ai-bookings/:id/verify-webhook", async (req, res): Promise<void> => {
  const params = AdminResolveAiBookingWebhookParams.safeParse(req.params);
  const body = AdminResolveAiBookingWebhookBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(422).json({ error: "Invalid delivery verification." }); return; }
  try {
    await services.resolveAiWebhook(params.data.id, body.data.verifiedInGhl, body.data.delivered);
    res.json(AdminResolveAiBookingWebhookResponse.parse((await services.readAiBookings()).find(b => b.id === params.data.id)));
  } catch (cause) { handleError(req, res, cause); }
});
return router;
}
export default createAiBookingsRouter();