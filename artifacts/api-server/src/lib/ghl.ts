import { logger } from "./logger";

const GHL_WEBHOOK_URL = process.env.GHL_WEBHOOK_URL;

export type GhlEvent =
  | "lead_captured"
  | "booking_confirmed"
  | "booking_created"
  | "ppf_quote_request"
  | "booking_abandoned";

// Full booking confirmation payload — triggers contact upsert + opportunity won in GHL
export interface GhlBookingConfirmedPayload {
  event: "booking_confirmed";
  // Contact fields — GHL uses these to create/update the contact record
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    tags: string[];
  };
  // Opportunity fields — GHL uses these to create the deal and mark it won
  opportunity: {
    title: string;
    status: "won";
    monetaryValue: number;
    pipelineStageName: string;
    notes: string;
  };
  // Extra context
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

// Legacy full payload (kept for backwards compat with other callers)
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

async function post(payload: unknown): Promise<void> {
  if (!GHL_WEBHOOK_URL) {
    logger.warn("GHL_WEBHOOK_URL not configured - skipping webhook");
    return;
  }
  const res = await fetch(GHL_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    logger.warn({ status: res.status }, "GHL webhook returned non-200");
  } else {
    logger.info({ event: (payload as any).event }, "GHL webhook sent");
  }
}

export async function sendGhlLeadWebhook(payload: GhlLeadPayload): Promise<void> {
  try {
    await post(payload);
  } catch (err) {
    logger.error({ err }, "Failed to send GHL lead webhook");
  }
}

export async function sendGhlWebhook(payload: GhlPayload): Promise<void> {
  try {
    await post(payload);
  } catch (err) {
    logger.error({ err }, "Failed to send GHL webhook");
  }
}

// Sends the booking-confirmed event that creates the contact and marks opportunity won
export async function sendGhlBookingConfirmed(payload: GhlBookingConfirmedPayload): Promise<void> {
  try {
    await post(payload);
  } catch (err) {
    logger.error({ err }, "Failed to send GHL booking-confirmed webhook");
  }
}
