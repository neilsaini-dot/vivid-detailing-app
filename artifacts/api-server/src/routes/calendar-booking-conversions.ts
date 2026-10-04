import { Router, type Request, type Response } from "express";
import {
  AdminListCalendarBookingConversionsQueryParams, AdminListCalendarBookingConversionsResponse,
  AdminSaveCalendarBookingConversionParams, AdminSaveCalendarBookingConversionBody, AdminSaveCalendarBookingConversionResponse,
  AdminConvertCalendarBookingParams, AdminConvertCalendarBookingBody, AdminConvertCalendarBookingResponse,
  AdminVerifyCalendarBookingWebhookParams, AdminVerifyCalendarBookingWebhookBody, AdminVerifyCalendarBookingWebhookResponse,
} from "@workspace/api-zod";
import { listCalendarBookingConversions, saveCalendarBookingConversion, convertCalendarBooking, verifyCalendarBookingWebhook } from "../lib/calendarBookingConversions";
import { CalendarConversionError } from "../lib/calendarBookingSources";
import { GhlAppointmentApiError } from "../lib/ghlAppointments";
import { SpecialSyncError } from "../lib/ghlSpecialBookings";
import { AiConversionError } from "../lib/aiBookingConversion";

const defaults = { listCalendarBookingConversions, saveCalendarBookingConversion, convertCalendarBooking, verifyCalendarBookingWebhook };
function handleError(req: Request, res: Response, cause: unknown) {
  if (cause instanceof CalendarConversionError || cause instanceof GhlAppointmentApiError
    || cause instanceof SpecialSyncError || cause instanceof AiConversionError) {
    res.status(cause.status).json({ error: cause.message }); return;
  }
  const failure = cause as { code?: string; cause?: { code?: string } };
  if (["42P01", "42703"].includes(failure.code ?? "") || ["42P01", "42703"].includes(failure.cause?.code ?? "")) {
    res.status(503).json({ error: "Conversion receipt setup is missing. Run scripts/migrate-ai-booking-conversions.sql in the existing database." }); return;
  }
  req.log.error({ errorName: cause instanceof Error ? cause.name : "UnknownError" }, "Calendar booking conversion failed");
  res.status(500).json({ error: "Calendar booking could not be processed. Refresh and check its receipt before retrying." });
}
export function createCalendarBookingConversionsRouter(services: typeof defaults = defaults) {
  const router = Router();
  router.get("/admin/calendar-booking-conversions", async (req, res): Promise<void> => {
    const params = AdminListCalendarBookingConversionsQueryParams.safeParse(req.query);
    if (!params.success) { res.status(422).json({ error: "Choose a valid month (YYYY-MM)." }); return; }
    try { res.json(AdminListCalendarBookingConversionsResponse.parse(await services.listCalendarBookingConversions(params.data.month))); }
    catch (cause) { handleError(req, res, cause); }
  });
  router.patch("/admin/calendar-booking-conversions/:id", async (req, res): Promise<void> => {
    const params = AdminSaveCalendarBookingConversionParams.safeParse(req.params);
    const body = AdminSaveCalendarBookingConversionBody.safeParse(req.body);
    if (!params.success || !body.success) { res.status(422).json({ error: "Invalid calendar review details." }); return; }
    try { res.json(AdminSaveCalendarBookingConversionResponse.parse(await services.saveCalendarBookingConversion(params.data.id, body.data))); }
    catch (cause) { handleError(req, res, cause); }
  });
  router.post("/admin/calendar-booking-conversions/:id/convert", async (req, res): Promise<void> => {
    const params = AdminConvertCalendarBookingParams.safeParse(req.params);
    const body = AdminConvertCalendarBookingBody.safeParse(req.body);
    if (!params.success || !body.success) { res.status(422).json({ error: "Invalid calendar conversion details." }); return; }
    try { res.json(AdminConvertCalendarBookingResponse.parse(await services.convertCalendarBooking(params.data.id, body.data))); }
    catch (cause) { handleError(req, res, cause); }
  });
  router.post("/admin/calendar-booking-conversions/:id/verify-webhook", async (req, res): Promise<void> => {
    const params = AdminVerifyCalendarBookingWebhookParams.safeParse(req.params);
    const body = AdminVerifyCalendarBookingWebhookBody.safeParse(req.body);
    if (!params.success || !body.success) { res.status(422).json({ error: "Invalid delivery verification." }); return; }
    try { res.json(AdminVerifyCalendarBookingWebhookResponse.parse(await services.verifyCalendarBookingWebhook(
      params.data.id, body.data.verifiedInGhl, body.data.delivered))); }
    catch (cause) { handleError(req, res, cause); }
  });
  return router;
}
export default createCalendarBookingConversionsRouter();