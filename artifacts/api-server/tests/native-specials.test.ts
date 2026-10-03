import { test } from "node:test";
import assert from "node:assert/strict";
import { CreateBookingBody } from "@workspace/api-zod";
import { prepareNativeSpecial } from "../src/lib/nativeSpecials";

function fixture(overrides: Record<string, unknown> = {}) {
  return CreateBookingBody.parse({
    specialOffer: "detailing_special",
    customer: { name: "Synthetic Test", email: "native-test@example.invalid", phone: "9025550100" },
    vehicle: { type: "car", year: 2020, make: "Test", model: "Fixture" },
    serviceIds: [], addOnIds: [], promoIds: [],
    appointmentAt: "2090-01-12T09:00:00-04:00", ...overrides,
  });
}

test("native pages enforce all eight tax-inclusive prices", () => {
  const totals = { car: 228.85, suv: 251.85, truck: 274.85, van: 309.35 };
  for (const [type, total] of Object.entries(totals)) {
    const detail = prepareNativeSpecial(fixture({ vehicle: { type } }));
    assert.equal(detail?.total, total);
    assert.equal(detail?.durationHours, 6);
    const ceramic = prepareNativeSpecial(fixture({ specialOffer: "ceramic_special", vehicle: { type } }));
    assert.equal(ceramic?.subtotal, 995);
    assert.equal(ceramic?.total, 1144.25);
    assert.equal(ceramic?.durationHours, 24);
  }
});

test("client prices and discounts cannot change a special's price", () => {
  assert.equal(prepareNativeSpecial(fixture({ totalEstimate: 1, bundleDiscount: 10000 }))?.total, 228.85);
});

test("ordinary booking pricing is left alone", () => {
  assert.equal(prepareNativeSpecial(fixture({ specialOffer: undefined })), null);
});

test("missing vehicle selection or unknown special is rejected", () => {
  assert.throws(() => fixture({ vehicle: { type: "" } }));
  assert.throws(() => fixture({ specialOffer: "free_detail" }));
});

test("specials reject unrelated items, invalid contacts, and missing or past appointments", () => {
  for (const input of [
    { serviceIds: ["ordinary-service"] }, { addOnIds: ["addon"] }, { promoIds: ["promo"] },
    { appointmentAt: undefined }, { appointmentAt: "2020-01-12T09:00:00Z" },
    { appointmentAt: "2090-01-12T09:00:00" },
    { customer: { name: "Test", email: "bad-email", phone: "9025550100" } },
    { customer: { name: "Test", email: "test@example.invalid", phone: "unknown" } },
  ]) assert.throws(() => prepareNativeSpecial(fixture(input)));
});