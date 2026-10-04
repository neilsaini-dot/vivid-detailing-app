export type BotOrigin = "chat_bot" | "voice_bot";
export type AppointmentOrigin = BotOrigin | "google" | "app" | "unknown";
export interface GhlAppointmentIdentity {
  locationId: string;
  appointmentId: string;
  calendarId: string;
  externalContactId?: string | null;
}
export class GhlAppointmentApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const API = "https://services.leadconnectorhq.com";
const normalized = (value: unknown) => typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/g, "") : "";

// Only explicit creator metadata is evidence. A calendar ID, contact tag,
// customer name or generic "api" source does not prove bot provenance.
export function appointmentOrigin(event: Record<string, unknown>): AppointmentOrigin {
  const creator = event.createdBy && typeof event.createdBy === "object"
    ? event.createdBy as Record<string, unknown> : {};
  const sources = [creator.source, creator.channel, creator.type, event.source, event.appointmentSource].map(normalized);
  if (sources.some(s => ["google", "googlecalendar"].includes(s))) return "google";
  if (sources.some(s => ["app", "vividapp", "vividdetailing"].includes(s))) return "app";
  if (sources.some(s => ["voiceai", "voiceaibot", "voicebot"].includes(s))) return "voice_bot";
  if (sources.some(s => ["conversationai", "conversationaibot", "chatai", "chatbot"].includes(s))) return "chat_bot";
  return "unknown";
}
type Config = { token: string; locationId: string; fetcher?: typeof fetch };
function config(): Config {
  const token = process.env.GHL_PRIVATE_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) throw new GhlAppointmentApiError(424, "GHL_PRIVATE_TOKEN and GHL_LOCATION_ID must be configured on the server.");
  return { token, locationId };
}
function options(settings: Config, method: string): RequestInit {
  return { method, headers: { Authorization: `Bearer ${settings.token}`, Version: "2021-04-15",
    Accept: "application/json", "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20000), ...(method === "DELETE" ? { body: "{}" } : {}) };
}
function checkLocation(identity: GhlAppointmentIdentity, settings: Config) {
  if (identity.locationId !== settings.locationId) throw new GhlAppointmentApiError(409, "The appointment does not belong to the configured GHL location.");
}
export async function getAppointmentOrigin(identity: GhlAppointmentIdentity, trustedOrigin?: BotOrigin | null, settings: Config = config()): Promise<AppointmentOrigin> {
  checkLocation(identity, settings);
  const response = await (settings.fetcher ?? fetch)(
    `${API}/calendars/events/appointments/${encodeURIComponent(identity.appointmentId)}`, options(settings, "GET"));
  if (response.status === 404 || response.status === 410) return "unknown";
  if (!response.ok) throw new GhlAppointmentApiError(424, `GHL appointment origin could not be verified (HTTP ${response.status}). Check calendars/events.readonly permission.`);
  const payload = await response.json() as { event?: Record<string, unknown>; appointment?: Record<string, unknown> };
  const event = payload.event ?? payload.appointment;
  // Some historical lookups succeed without returning an event. As with a
  // 404, its identity/provenance cannot be verified: never trust a bot marker.
  if (!event || event.deleted === true) return "unknown";
  if (!event || event.id !== identity.appointmentId || event.calendarId !== identity.calendarId
    || (event.locationId && event.locationId !== identity.locationId)
    || (event.contactId && identity.externalContactId && event.contactId !== identity.externalContactId)) {
    const mismatches = [
      !event && "missing event",
      event && event.id !== identity.appointmentId && "appointment ID",
      event && event.calendarId !== identity.calendarId && "calendar ID",
      event?.locationId && event.locationId !== identity.locationId && "location ID",
      event?.contactId && identity.externalContactId && event.contactId !== identity.externalContactId && "contact ID",
    ].filter(Boolean);
    throw new GhlAppointmentApiError(409, `GHL appointment ${identity.appointmentId} identity could not be verified: ${mismatches.join(", ")} mismatch.`);
  }
  const origin = appointmentOrigin(event);
  // Bot-only, authenticated workflow intake may supply an explicit marker
  // when GHL's API reports only a generic creator. Google/app always wins.
  return origin === "unknown" ? trustedOrigin ?? "unknown" : origin;
}
export async function deleteGhlAppointment(identity: GhlAppointmentIdentity, settings: Config = config()): Promise<void> {
  checkLocation(identity, settings);
  const response = await (settings.fetcher ?? fetch)(
    `${API}/calendars/events/${encodeURIComponent(identity.appointmentId)}`, options(settings, "DELETE"));
  // DELETE is idempotent. Never use PATCH appointmentStatus=cancelled.
  if (response.status === 404 || response.status === 410) return;
  if (!response.ok) throw new GhlAppointmentApiError(424, `GHL appointment delete failed (HTTP ${response.status}). Delete the original appointment manually.`);
  if (response.status === 204) return;
  const result = await response.json().catch(() => null) as { succeeded?: boolean } | null;
  if (result?.succeeded !== true) throw new GhlAppointmentApiError(424, "GHL did not confirm appointment deletion. Check and delete it manually.");
}

export async function inspectAppointmentLookup(identity: GhlAppointmentIdentity, settings: Config = config()) {
  checkLocation(identity, settings);
  const response = await (settings.fetcher ?? fetch)(
    `${API}/calendars/events/appointments/${encodeURIComponent(identity.appointmentId)}`, options(settings, "GET"));
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const responseFields = Object.keys(payload).flatMap(key => {
    const value = payload[key];
    return [key, ...(value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).map(child => `${key}.${child}`) : [])];
  });
  // Expose schema keys and a classification, never payload values, contacts,
  // credentials, message bodies, or arbitrary provider error text.
  const candidate = payload.event ?? payload.appointment;
  const event = candidate && typeof candidate === "object"
    ? candidate as Record<string, unknown> : null;
  return { httpStatus: response.status, responseFields, eventFound: !!event,
    origin: event ? appointmentOrigin(event) : "unknown" };
}