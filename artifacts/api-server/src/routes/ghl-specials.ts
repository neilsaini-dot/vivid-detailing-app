import { Router, type RequestHandler } from "express";
import { SyncGhlSpecialBookingBody, SyncGhlSpecialBookingResponse } from "@workspace/api-zod";
import { getSpecialsConfig, validSpecialsToken, specialForCalendar, type SpecialsConfig } from "../lib/ghlSpecialsConfig";
import { normaliseSpecialInput, SpecialSyncError, syncSpecialAppointment } from "../lib/ghlSpecialBookings";

const router = Router();

// Dependency injection lets tests exercise real transactions without modifying
// environment secrets or calling external services.
export function createGhlSpecialBookingHandler(
  configProvider: () => SpecialsConfig | null = getSpecialsConfig,
  sync = syncSpecialAppointment,
): RequestHandler {
 return async (req, res): Promise<void> => {
  const config = configProvider();
  if (!config) {
    res.status(503).json({ error: "Specials receiver is not configured.", code: "configuration_missing" });
    return;
  }
  if (!validSpecialsToken(req.get("authorization"), config.secret)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const parsed = SyncGhlSpecialBookingBody.safeParse(normaliseSpecialInput(req.body));
  if (!parsed.success) {
    // Zod messages may include supplied values. Log only schema paths and codes.
    req.log.warn({
      statusCode: 422,
      code: "invalid_appointment",
      fields: parsed.error.issues.map(i => ({ path: i.path.join("."), code: i.code })),
    }, "GHL special-bookings validation failed (422)");
    res.status(422).json({
      error: "Invalid appointment data.",
      fields: parsed.error.issues.map(i => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }
  if (parsed.data.locationId !== config.locationId || !specialForCalendar(parsed.data.calendarId)) {
    res.status(403).json({ error: "Location or calendar is not allowed." });
    return;
  }
  try {
    const result = await sync(parsed.data);
    res.status(result.action === "created" ? 201 : 200).json(SyncGhlSpecialBookingResponse.parse(result));
  } catch (error) {
    if (error instanceof SpecialSyncError) {
      // These messages are application-defined rules, never payload values.
      req.log.warn({
        statusCode: error.status,
        code: error.code,
        reason: error.message,
      }, "GHL special-bookings sync rejected");
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    const dbError = error as { code?: string; cause?: { code?: string } };
    if (dbError.code === "42P01" || dbError.cause?.code === "42P01") {
      req.log.error("Specials database migration is missing.");
      res.status(503).json({ error: "Specials database migration is required.", code: "migration_missing" });
      return;
    }
    // Do not log the payload or SQL parameters: they contain customer information.
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Specials sync transaction failed.");
    res.status(500).json({ error: "Booking sync failed. Retry delivery.", code: "sync_failed" });
  }
 };
}

router.post("/integrations/ghl/special-bookings", createGhlSpecialBookingHandler());
export default router;