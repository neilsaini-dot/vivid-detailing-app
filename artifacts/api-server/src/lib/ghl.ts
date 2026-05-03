import { logger } from "./logger";

const GHL_WEBHOOK_URL = process.env.GHL_WEBHOOK_URL;
const GHL_BOOKING_CONFIRMED_WEBHOOK_URL = process.env.GHL_BOOKING_CONFIRMED_WEBHOOK_URL;
const GHL_MAGIC_LINK_WEBHOOK_URL = process.env.GHL_MAGIC_LINK_WEBHOOK_URL;

export type GhlEvent =
  | "lead_captured"
  | "booking_confirmed"
  | "booking_created"
  | "ppf_quote_request"
  | "booking_abandoned"
  | "magic_link_requested";

// Full booking confirmation payload — triggers contact upsert + opportunity won in GHL
export interface GhlBookingConfirmedPayload {
  event: "booking_confirmed";
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    tags: string[];
  };
  opportunity: {
    title: string;
    status: "won";
    monetaryValue: number;
    pipelineStageName: string;
    notes: string;
  };
  booking: {
    id: string;
    services: string[];
    addons: string[];
    vehicle: string;
    appointment_at: string | null;
    total_estimate: number;
    is_quote_based: boolean;
    notes: string | null;
  };
  source: "vivid-app";
}

export interface GhlLeadPayload {
  event: "lead_captured";
  customer: { id: string; name: string; phone: string };
  tags: ["Lead", "Partial"];
  source: "vivid-app";
}

export interface GhlPayload {
  event: GhlEvent;
  customer: { name: string; email: string; phone: string };
  vehicle: { type: string; year?: string; make?: string; model?: string };
  booking: {
    service_category: string;
    package: string;
    addons: string[];
    total_estimate: number;
    appointment_at: string | null;
    notes: string | null;
    is_quote_based: boolean;
    coverage_option?: string;
    last_step?: number;
  };
  tags: string[];
  source: "vivid-app";
}

async function postTo(url: string, payload: unknown, label: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    logger.warn({ status: res.status, label }, "GHL webhook returned non-200");
  } else {
    logger.info({ event: (payload as any).event, label }, "GHL webhook sent");
  }
}

// Lead capture — goes to GHL_WEBHOOK_URL
export async function sendGhlLeadWebhook(payload: GhlLeadPayload): Promise<void> {
  if (!GHL_WEBHOOK_URL) {
    logger.warn("GHL_WEBHOOK_URL not configured - skipping lead webhook");
    return;
  }
  try {
    await postTo(GHL_WEBHOOK_URL, payload, "lead");
  } catch (err) {
    logger.error({ err }, "Failed to send GHL lead webhook");
  }
}

// Legacy full payload — goes to GHL_WEBHOOK_URL
export async function sendGhlWebhook(payload: GhlPayload): Promise<void> {
  if (!GHL_WEBHOOK_URL) {
    logger.warn("GHL_WEBHOOK_URL not configured - skipping webhook");
    return;
  }
  try {
    await postTo(GHL_WEBHOOK_URL, payload, "legacy");
  } catch (err) {
    logger.error({ err }, "Failed to send GHL webhook");
  }
}

// Booking confirmed — goes to dedicated GHL_BOOKING_CONFIRMED_WEBHOOK_URL
// Falls back to GHL_WEBHOOK_URL if the dedicated URL is not configured
export async function sendGhlBookingConfirmed(payload: GhlBookingConfirmedPayload): Promise<void> {
  const url = GHL_BOOKING_CONFIRMED_WEBHOOK_URL || GHL_WEBHOOK_URL;
  if (!url) {
    logger.warn("No GHL URL configured for booking_confirmed - skipping");
    return;
  }
  if (!GHL_BOOKING_CONFIRMED_WEBHOOK_URL) {
    logger.warn("GHL_BOOKING_CONFIRMED_WEBHOOK_URL not set - falling back to GHL_WEBHOOK_URL");
  }
  try {
    await postTo(url, payload, "booking_confirmed");
  } catch (err) {
    logger.error({ err }, "Failed to send GHL booking-confirmed webhook");
  }
}
