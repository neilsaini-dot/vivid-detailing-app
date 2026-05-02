export type VehicleType = "car" | "suv" | "truck" | "van";
export type PricingRule =
  | "flat"
  | "seasonal_flat"
  | "fixed_by_vehicle_type"
  | "vehicle_multiplier_round5"
  | "quote_based"
  | "admin_configurable";

export const VEHICLE_MULTIPLIERS: Record<VehicleType, number> = {
  car: 1.0,
  suv: 1.2,
  truck: 1.3,
  van: 1.4,
};

export function roundUpToNearestFive(amount: number): number {
  return Math.ceil(amount / 5) * 5;
}

export function calculateServicePrice(
  service: {
    pricingRule: string;
    basePrice: string | number | null;
    prices: Array<{ vehicleType: string; price: string | number }>;
  },
  vehicleType: VehicleType
): number | "quote" | "pending" {
  const rule = service.pricingRule as PricingRule;

  switch (rule) {
    case "flat":
    case "seasonal_flat":
      return service.basePrice != null ? Number(service.basePrice) : "pending";

    case "fixed_by_vehicle_type": {
      const entry = service.prices.find((p) => p.vehicleType === vehicleType);
      return entry ? Number(entry.price) : "pending";
    }

    case "vehicle_multiplier_round5": {
      if (service.basePrice == null) return "pending";
      const base = Number(service.basePrice);
      const multiplier = VEHICLE_MULTIPLIERS[vehicleType];
      return roundUpToNearestFive(base * multiplier);
    }

    case "quote_based":
      return "quote";

    case "admin_configurable":
      // Only show price if base is confirmed (non-null)
      if (service.basePrice == null) return "pending";
      const base = Number(service.basePrice);
      const multiplier = VEHICLE_MULTIPLIERS[vehicleType];
      return roundUpToNearestFive(base * multiplier);

    default:
      return "pending";
  }
}

export const HST_RATE = 0.15;

export function getLoyaltyTier(lifetimeSpend: number): "Silver" | "Black" | "Elite" {
  if (lifetimeSpend >= 3000) return "Elite";
  if (lifetimeSpend >= 1000) return "Black";
  return "Silver";
}

export function getNextTier(tier: string): { name: string | null; threshold: number | null } {
  if (tier === "Silver") return { name: "Black", threshold: 1000 };
  if (tier === "Black") return { name: "Elite", threshold: 3000 };
  return { name: null, threshold: null };
}

export function getLoyaltyProgress(lifetimeSpend: number, tier: string): number {
  if (tier === "Silver") return Math.min((lifetimeSpend / 1000) * 100, 100);
  if (tier === "Black") return Math.min(((lifetimeSpend - 1000) / 2000) * 100, 100);
  return 100;
}
