import { test, expect, type Page } from "@playwright/test";
import { halifaxWallToIso } from "../src/lib/halifax-time";

// Browser tests stub external availability and booking responses; they must
// never create real customer appointments or send shop messages.
async function calendar(page: Page) {
  await page.route("**/api/calendar/**", async route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("strict")).toBe("true");
    const duration = Number(url.searchParams.get("duration"));
    await route.fulfill({
      json: url.pathname.endsWith("next-slots")
        ? { duration, slots: [{ date: "2027-01-12", start: "09:00", end: "15:00", label: "9:00 AM", dateLabel: "Tuesday, January 12" }] }
        : { date: url.searchParams.get("date"), duration, slots: [{ start: "09:00", end: "15:00", label: "9:00 AM", available: true, bookingsToday: 0 }] },
    });
  });
}

async function details(page: Page) {
  await page.getByTestId("input-name").fill("Synthetic Customer");
  await page.getByTestId("input-phone").fill("9025550100");
  await page.getByTestId("input-email").fill("browser-test@example.invalid");
  await page.getByTestId("input-year").fill("2020");
  await page.getByTestId("input-make").fill("Test");
  await page.getByTestId("input-model").fill("Fixture");
  await page.getByTestId("button-next-slot-0").click();
}

test("mobile detailing page requires vehicle selection and displays all correct totals", async ({ page }) => {
  await calendar(page);
  await page.goto("/detailing-special/");
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  await details(page);
  await page.getByTestId("button-submit-booking").click();
  await expect(page.getByTestId("booking-confirmation")).toHaveCount(0);
  for (const [type, total] of Object.entries({ car: "$228.85", suv: "$251.85", truck: "$274.85", van: "$309.35" })) {
    await page.getByTestId(`button-vehicle-${type}`).click();
    await expect(page.getByTestId("text-total-price")).toHaveText(total);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("mobile ceramic page prices every vehicle at $995 plus HST and states years of maintenance", async ({ page }) => {
  await calendar(page);
  await page.goto("/ceramic-special");
  await expect(page.getByText("Coating rated for up to 5 years, including 3 years of maintenance applications")).toBeVisible();
  for (const type of ["car", "suv", "truck", "van"]) {
    await page.getByTestId(`button-vehicle-${type}`).click();
    await expect(page.getByTestId("text-base")).toHaveText("$995.00");
    await expect(page.getByTestId("text-total-price")).toHaveText("$1,144.25");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("native submission sends trusted offer key, Halifax time, and shows returned booking", async ({ page }) => {
  await calendar(page);
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/bookings", async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: {
      id: "synthetic-booking", status: "pending", totalEstimate: 251.85,
      appointmentAt: "2027-01-12T13:00:00Z", items: [], customer: null, vehicle: null,
    } });
  });
  await page.goto("/detailing-special");
  await details(page);
  await page.getByTestId("button-vehicle-suv").click();
  await page.getByTestId("button-submit-booking").click();
  await expect(page.getByTestId("booking-confirmation")).toBeVisible();
  expect(submitted?.specialOffer).toBe("detailing_special");
  expect(submitted?.appointmentAt).toBe("2027-01-12T09:00:00-04:00");
  expect(submitted?.serviceIds).toEqual([]);
  expect(submitted).not.toHaveProperty("totalEstimate");
  expect(submitted).not.toHaveProperty("bundleDiscount");
  await expect(page.getByTestId("text-booking-id")).toHaveText("synthetic-booking");
  await expect(page.getByTestId("text-booking-status")).toHaveText("pending");
  await page.getByTestId("link-other-special").click();
  await expect(page.getByTestId("booking-confirmation")).toHaveCount(0);
  await expect(page.getByTestId("form-special-booking")).toBeVisible();
});

test("calendar failure does not invent openings or allow an incomplete booking", async ({ page }) => {
  await page.route("**/api/calendar/**", route => route.fulfill({ status: 502, json: { error: "Calendar unavailable" } }));
  await page.goto("/ceramic-special/");
  await expect(page.getByTestId("button-next-slot-0")).toHaveCount(0);
  await page.getByTestId("button-submit-booking").click();
  await expect(page.getByTestId("booking-confirmation")).toHaveCount(0);
});

test("Halifax times do not depend on the visitor's device timezone", () => {
  expect(halifaxWallToIso("2027-01-12", "09:00")).toBe("2027-01-12T09:00:00-04:00");
  expect(halifaxWallToIso("2027-07-12", "09:00")).toBe("2027-07-12T09:00:00-03:00");
});