import { z } from "zod/v4";
import { specialPriceCents, SPECIAL_NAMES, type SpecialKey } from "./ghlSpecialsConfig";
import { CreateBookingBody } from "@workspace/api-zod";

type BookingInput = ReturnType<typeof CreateBookingBody.parse>;

export const specialCustomerSchema = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.email().max(254),
  phone: z.string().trim().min(7).max(50).refine(
    value => /^\+?[\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 7
      && value.replace(/\D/g, "").length <= 15,
    "Enter a valid phone number.",
  ),
});

export function prepareNativeSpecial(input: BookingInput) {
  const special = input.specialOffer;
  if (!special) return null;
  specialCustomerSchema.parse(input.customer);
  if (input.serviceIds.length || input.addOnIds.length || input.promoIds.length) {
    throw new Error("Special bookings cannot include ordinary packages or extras. Request extras in notes for staff to review.");
  }
  if (!input.appointmentAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(input.appointmentAt)) {
    throw new Error("Choose an appointment date and time with a valid timezone.");
  }
  const appointment = new Date(input.appointmentAt);
  if (!Number.isFinite(appointment.getTime()) || appointment <= new Date()) {
    throw new Error("Choose a future appointment time.");
  }
  if (input.notes && input.notes.length > 4000) throw new Error("Notes must be 4,000 characters or fewer.");
  const cents = specialPriceCents(special, input.vehicle.type);
  return {
    special: special as SpecialKey,
    itemName: SPECIAL_NAMES[special],
    subtotal: cents / 100,
    total: (cents + Math.round(cents * 0.15)) / 100,
    durationHours: special === "ceramic_special" ? 24 : 6,
  };
}