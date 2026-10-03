import { Router, type RequestHandler } from "express";
import type { ZodIssue } from "zod";
import { SyncGhlSpecialBookingBody, SyncGhlSpecialBookingResponse } from "@workspace/api-zod";
import { getSpecialsConfig, validSpecialsToken, specialForCalendar, type SpecialsConfig } from "../lib/ghlSpecialsConfig";
import { normaliseSpecialInput, SpecialSyncError, syncSpecialAppointment } from "../lib/ghlSpecialBookings";

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

// Enum-like fields (appointmentStatus, vehicle.type) are not customer data, so
// their normalised values are safe to log. Truncate to bound log size, and
// report the type for non-string values (e.g. null, number, object).
function describeEnumValue(value: unknown): string {
  if (value === undefined) return "<undefined>";
  if (value === null) return "<null>";
  if (typeof value === "string") return JSON.stringify(value.length > 100 ? `${value.slice(0, 100)}…` : value);
  return `<${Array.isArray(value) ? "array" : typeof value}>`;
}

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
  const normalised = normaliseSpecialInput(req.body);
  const parsed = SyncGhlSpecialBookingBody.safeParse(normalised);
  if (!parsed.success) {
    const received = normalised && typeof normalised === "object" && !Array.isArray(normalised)
      ? normalised as Record<string, unknown>
      : {};
    const vehicle = received.vehicle && typeof received.vehicle === "object" && !Array.isArray(received.vehicle)
      ? received.vehicle as Record<string, unknown>
      : undefined;
    req.log.warn({
      receivedAppointmentStatus: describeEnumValue(received.appointmentStatus),
      receivedVehicleType: describeEnumValue(vehicle?.type),
    }, "GHL special-bookings received enum values (post-normalisation) for failed validation");
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
      }, `GHL special-bookings sync rejected (${error.status}): ${error.message}`);
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