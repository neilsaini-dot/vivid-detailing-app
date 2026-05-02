import { logger } from "./logger";

const GHL_WEBHOOK_URL = process.env.GHL_WEBHOOK_URL;

export type GhlEvent =
  | "booking_created"
  | "ppf_quote_request"
  | "booking_abandoned";

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

export async function sendGhlWebhook(payload: GhlPayload): Promise<void> {
  if (!GHL_WEBHOOK_URL) {
    logger.warn("GHL_WEBHOOK_URL not configured — skipping webhook");
    return;
  }

  try {
    const res = await fetch(GHL_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, "GHL webhook returned non-200");
    } else {
      logger.info({ event: payload.event }, "GHL webhook sent");
    }
  } catch (err) {
    logger.error({ err }, "Failed to send GHL webhook");
  }
}
