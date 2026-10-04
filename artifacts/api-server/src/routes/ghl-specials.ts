import { Router, type RequestHandler } from "express";
import type { ZodIssue } from "zod";
import { SyncGhlSpecialBookingBody, SyncGhlSpecialBookingResponse } from "@workspace/api-zod";
import { getSpecialsConfig, validSpecialsToken, specialForCalendar, type SpecialsConfig } from "../lib/ghlSpecialsConfig";
import { normaliseSpecialInput, specialTimestampDiagnostics, SpecialSyncError, syncSpecialAppointment } from "../lib/ghlSpecialBookings";
import { rememberAiBotOrigin } from "../lib/aiBookingConversion";
import { getAppointmentOrigin } from "../lib/ghlAppointments";

const router = Router();

// Explain schema rules without Zod's raw messages, which can echo private input.
function validationReason(issue: ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined"
        ? `required; expected ${issue.expected}`
        : `expected ${issue.expected}`;
    case "invalid_enum_value":
      return `expected one of ${issue.options.map(value => JSON.stringify(value)).join(", ")}`;
    case "too_small":
      return `minimum ${issue.minimum}${issue.type === "string" ? " characters" : ""}`;
    case "too_big":
      return `maximum ${issue.maximum}${issue.type === "string" ? " characters" : ""}`;
    case "invalid_union":
      return "invalid type; vehicle.year must be a number or string (or omitted/null)";
    default:
      return `invalid format (${issue.code})`;
  }
}

// Dependency injection lets tests exercise real transactions without modifying
// environment secrets or calling external services.
export function createGhlSpecialBookingHandler(
  configProvider: () => SpecialsConfig | null = getSpecialsConfig,
  sync = syncSpecialAppointment,
  originResolver = getAppointmentOrigin,
  verifyOrigins = () => Boolean(process.env.GHL_PRIVATE_TOKEN && process.env.GHL_LOCATION_ID),
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
  const ignoredFields: string[] = [];
  const parsed = SyncGhlSpecialBookingBody.safeParse(normaliseSpecialInput(req.body, ignoredFields));
  if (!parsed.success) {
    const fields = parsed.error.issues.map(i => ({
      path: i.path.join(".") || "body",
      code: i.code,
      message: validationReason(i),
    }));
    const summary = fields.map(f => `${f.path}: ${f.message}`).join("; ");
    req.log.warn({
      statusCode: 422,
      code: "invalid_appointment",
      fields,
    }, `GHL special-bookings validation failed (422): ${summary}`);
    res.status(422).json({
      error: "Invalid appointment data.",
      fields: parsed.error.issues.map(i => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }
  if (parsed.data.locationId !== config.locationId) {
    res.status(403).json({ error: "Location is not allowed." });
    return;
  }
  if (ignoredFields.length) {
    req.log.warn({ code: "optional_intake_ignored", ignoredFields },
      `GHL special-bookings ignored unusable optional intake fields: ${ignoredFields.join(", ")}`);
  }
  try {
    if (verifyOrigins()
      && parsed.data.appointmentStatus !== "cancelled" && parsed.data.appointmentStatus !== "canceled") {
      const origin = await originResolver({
        locationId: parsed.data.locationId, appointmentId: parsed.data.appointmentId,
        calendarId: parsed.data.calendarId, externalContactId: parsed.data.contact?.id,
      }, parsed.data.bookingOrigin);
      if (origin === "google" || origin === "app") {
        res.status(200).json(SyncGhlSpecialBookingResponse.parse({
          success: true, action: "ignored", bookingId: null,
          special: specialForCalendar(parsed.data.calendarId) ?? "highlevel_booking", status: "ignored", totalEstimate: null,
          reason: "app_or_google_origin",
        }));
        return;
      }
    }
    const result = await sync(parsed.data);
    if (result.bookingId && parsed.data.bookingOrigin) {
      await rememberAiBotOrigin(result.bookingId, parsed.data.bookingOrigin);
    }
    res.status(result.action === "created" ? 201 : 200).json(SyncGhlSpecialBookingResponse.parse(result));
  } catch (error) {
    if (error instanceof SpecialSyncError) {
      // Include both timestamps when either fails. Safe diagnostics are also
      // in the primary message because Railway may hide structured properties.
      const timestamps = /^(startTime|endTime|eventUpdatedAt)\b/.test(error.message)
        ? {
          startTime: specialTimestampDiagnostics(req.body?.startTime),
          endTime: specialTimestampDiagnostics(req.body?.endTime),
        } : undefined;
      req.log.warn({
        statusCode: error.status,
        code: error.code,
        reason: error.message,
        ...(timestamps ? { timestamps } : {}),
      }, `GHL special-bookings sync rejected (${error.status}): ${error.message}${timestamps ? `; timestamp diagnostics: ${JSON.stringify(timestamps)}` : ""}`);
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