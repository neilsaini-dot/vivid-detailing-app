import { createHash, timingSafeEqual } from "node:crypto";

export const SPECIAL_CALENDARS = {
  ceramic: "w3wIA0X8OrUEnHtDaOQZ",
  detailing: "5gTCnqzF1ruvjvlf0kVv",
} as const;

export type SpecialKey = "ceramic_special" | "detailing_special";
export type SpecialVehicleType = "car" | "suv" | "truck" | "van";

export const SPECIAL_NAMES: Record<SpecialKey, string> = {
  ceramic_special: "Ceramic Coating Special",
  detailing_special: "Full Interior & Exterior Detail Special",
};

export interface SpecialsConfig {
  secret: string;
  locationId: string;
}

export function getSpecialsConfig(): SpecialsConfig | null {
  const secret = process.env.GHL_SPECIALS_WEBHOOK_SECRET;
  const locationId = process.env.GHL_SPECIALS_LOCATION_ID?.trim();
  if (!secret || secret.length < 32 || !locationId) return null;
  return { secret, locationId };
}

export function validSpecialsToken(header: string | undefined, secret: string): boolean {
  const token = header?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token) return false;
  return timingSafeEqual(
    createHash("sha256").update(token).digest(),
    createHash("sha256").update(secret).digest(),
  );
}

export function specialForCalendar(calendarId: string): SpecialKey | null {
  if (calendarId === SPECIAL_CALENDARS.ceramic) return "ceramic_special";
  if (calendarId === SPECIAL_CALENDARS.detailing) return "detailing_special";
  return null;
}

export function specialPriceCents(special: SpecialKey, vehicleType: SpecialVehicleType): number {
  if (special === "ceramic_special") return 99500;
  return { car: 19900, suv: 21900, truck: 23900, van: 26900 }[vehicleType];
}