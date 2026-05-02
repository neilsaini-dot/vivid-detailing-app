import { db } from "@workspace/db";
import {
  servicesTable,
  servicePricesTable,
  addOnsTable,
  addOnPricesTable,
  seasonalPromosTable,
} from "@workspace/db";

const VEHICLE_TYPES = ["car", "suv", "truck", "van"] as const;

async function seed() {
  console.log("Seeding database...");

  await db.delete(servicePricesTable);
  await db.delete(addOnPricesTable);
  await db.delete(servicesTable);
  await db.delete(addOnsTable);
  await db.delete(seasonalPromosTable);

  // ── SERVICES ──────────────────────────────────────────────────

  const [vi] = await db.insert(servicesTable).values({
    name: "Vivid Interior",
    category: "detailing",
    pricingRule: "vehicle_multiplier_round5",
    basePrice: "175",
    isActive: true, isSeasonal: false, sortOrder: 1,
    description: "Deep interior detail — seats, carpets, dash, panels, and glass cleaned to a showroom finish.",
    includes: ["Seat extraction & shampoo", "Carpet shampoo", "Leather conditioning", "Vent cleaning", "Full glass clean"],
    showInProtectionStep: false,
  }).returning();
  await db.insert(servicePricesTable).values([
    { serviceId: vi.id, vehicleType: "car", price: "175" },
    { serviceId: vi.id, vehicleType: "suv", price: "195" },
    { serviceId: vi.id, vehicleType: "truck", price: "215" },
    { serviceId: vi.id, vehicleType: "van", price: "235" },
  ]);

  const [vl] = await db.insert(servicesTable).values({
    name: "Vivid Luster",
    category: "detailing",
    pricingRule: "vehicle_multiplier_round5",
    basePrice: "249",
    isActive: true, isSeasonal: false, sortOrder: 2,
    description: "Complete exterior detail — hand wash, clay bar, tire shine, and spray wax for a showroom-ready shine.",
    includes: ["Hand wash & dry", "Clay bar decontamination", "Tire & wheel cleaning", "Spray wax", "Exterior glass clean"],
    showInProtectionStep: false,
  }).returning();
  await db.insert(servicePricesTable).values([
    { serviceId: vl.id, vehicleType: "car", price: "219" },
    { serviceId: vl.id, vehicleType: "suv", price: "239" },
    { serviceId: vl.id, vehicleType: "truck", price: "259" },
    { serviceId: vl.id, vehicleType: "van", price: "279" },
  ]);

  const [vg] = await db.insert(servicesTable).values({
    name: "Vivid Glow",
    category: "detailing",
    pricingRule: "vehicle_multiplier_round5",
    basePrice: "299",
    isActive: true, isSeasonal: false, sortOrder: 3,
    description: "Full interior + exterior detail with a single-stage paint enhancement for a deeper, glossier finish.",
    includes: ["Everything in Vivid Luster", "Single-stage machine polish", "Paint decontamination", "Interior detail", "Tire dressing"],
    showInProtectionStep: false,
  }).returning();
  await db.insert(servicePricesTable).values([
    { serviceId: vg.id, vehicleType: "car", price: "299" },
    { serviceId: vg.id, vehicleType: "suv", price: "319" },
    { serviceId: vg.id, vehicleType: "truck", price: "339" },
    { serviceId: vg.id, vehicleType: "van", price: "359" },
  ]);

  const [ss] = await db.insert(servicesTable).values({
    name: "Summer Special Ceramic Exterior",
    category: "seasonal",
    pricingRule: "flat",
    basePrice: "249",
    isActive: true, isSeasonal: true, sortOrder: 4,
    description: "1-year ceramic exterior protection at a summer-exclusive flat rate. Any vehicle, one price.",
    includes: ["Exterior wash", "Paint decontamination", "Ceramic (painted surfaces)", "1-year protection", "Free maintenance wash"],
    showInProtectionStep: false,
  }).returning();
  await db.insert(servicePricesTable).values(
    VEHICLE_TYPES.map(vt => ({ serviceId: ss.id, vehicleType: vt, price: "249" }))
  );

  const [cgp] = await db.insert(servicesTable).values({
    name: "Vivid Ceramic Gloss Pro",
    category: "ceramic",
    pricingRule: "vehicle_multiplier_round5",
    basePrice: "299",
    isActive: true, isSeasonal: false, sortOrder: 5,
    description: "Entry-level professional ceramic coating with 1-year durability. Hydrophobic, scratch-resistant, gloss-enhancing.",
    includes: ["Paint decontamination", "Ceramic coating (painted surfaces)", "1-year protection", "Hydrophobic finish"],
    showInProtectionStep: false,
  }).returning();
  await db.insert(servicePricesTable).values([
    { serviceId: cgp.id, vehicleType: "car", price: "299" },
    { serviceId: cgp.id, vehicleType: "suv", price: "360" },
    { serviceId: cgp.id, vehicleType: "truck", price: "390" },
    { serviceId: cgp.id, vehicleType: "van", price: "420" },
  ]);

  const [cg] = await db.insert(servicesTable).values({
    name: "Vivid Ceramic Guard",
    category: "ceramic",
    pricingRule: "vehicle_multiplier_round5",
    basePrice: "999",
    isActive: true, isSeasonal: false, sortOrder: 6,
    description: "3-year ceramic protection with a single-stage paint enhancement. Covers paint, trim, and glass surfaces.",
    includes: ["Decontamination wash", "Single-stage paint enhancement", "Ceramic (paint + trim)", "3-year protection"],
    showInProtectionStep: false,
  }).returning();
  await db.insert(servicePricesTable).values([
    { serviceId: cg.id, vehicleType: "car", price: "999" },
    { serviceId: cg.id, vehicleType: "suv", price: "1200" },
    { serviceId: cg.id, vehicleType: "truck", price: "1300" },
    { serviceId: cg.id, vehicleType: "van", price: "1400" },
  ]);

  const [ceg] = await db.insert(servicesTable).values({
    name: "Vivid Ceramic Elite Guard",
    category: "ceramic",
    pricingRule: "admin_configurable",
    basePrice: "1299",
    isActive: true, isSeasonal: false, sortOrder: 7,
    description: "Our most comprehensive ceramic package — 5-year durability covering paint, trim, and glass.",
    includes: ["Everything in Ceramic Guard", "5-year ceramic durability", "Premium paint enhancement", "Glass ceramic included"],
    showInProtectionStep: false,
  }).returning();
  await db.insert(servicePricesTable).values(
    VEHICLE_TYPES.map(vt => ({ serviceId: ceg.id, vehicleType: vt, price: "1299" }))
  );

  const [ctr] = await db.insert(servicesTable).values({
    name: "Vivid Ceramic Tint - Rear",
    category: "tint",
    pricingRule: "flat",
    basePrice: "275",
    isActive: true, isSeasonal: false, sortOrder: 8,
    description: "Nano ceramic IR tint on back windows and rear windshield. Lifetime warranty.",
    includes: ["Back side windows", "Rear windshield", "Nano ceramic IR film", "Lifetime warranty"],
    showInProtectionStep: false,
  }).returning();
  await db.insert(servicePricesTable).values(
    VEHICLE_TYPES.map(vt => ({ serviceId: ctr.id, vehicleType: vt, price: "275" }))
  );

  const [ctf] = await db.insert(servicesTable).values({
    name: "Vivid Ceramic Tint - Full",
    category: "tint",
    pricingRule: "flat",
    basePrice: "350",
    isActive: true, isSeasonal: false, sortOrder: 9,
    description: "Full vehicle nano ceramic IR tint — rear + all front side windows. Lifetime warranty.",
    includes: ["All side windows", "Rear windshield", "Nano ceramic IR film", "Lifetime warranty"],
    showInProtectionStep: false,
  }).returning();
  await db.insert(servicePricesTable).values(
    VEHICLE_TYPES.map(vt => ({ serviceId: ctf.id, vehicleType: vt, price: "350" }))
  );

  const [wet] = await db.insert(servicesTable).values({
    name: "Windshield Eyebrow Tint",
    category: "tint",
    pricingRule: "flat",
    basePrice: "50",
    isActive: true, isSeasonal: false, sortOrder: 10,
    description: "A tinted visor strip along the top of the windshield to cut sun glare.",
    includes: ["Top 6\" windshield strip", "Carbon or ceramic film", "Lifetime warranty"],
    showInProtectionStep: false,
  }).returning();
  await db.insert(servicePricesTable).values(
    VEHICLE_TYPES.map(vt => ({ serviceId: wet.id, vehicleType: vt, price: "50" }))
  );

  const [pc] = await db.insert(servicesTable).values({
    name: "Paint Correction",
    category: "paint_correction",
    pricingRule: "quote_based",
    basePrice: null,
    isActive: true, isSeasonal: false, sortOrder: 11,
    description: "Single or multi-stage machine polishing to remove swirl marks, scratches, and oxidation. Priced after inspection.",
    includes: ["Paint decontamination", "Machine polish", "Before/after photos", "Quote-based pricing"],
    showInProtectionStep: false,
  }).returning();

  await db.insert(servicesTable).values({
    name: "PPF - Full Front",
    category: "ppf",
    pricingRule: "quote_based",
    basePrice: null,
    isActive: true, isSeasonal: false, sortOrder: 12,
    description: "Paint Protection Film on the full front end — hood, fenders, mirrors, bumper, A-pillars.",
    includes: ["Hood", "Fenders", "Front bumper", "Side mirrors", "A-pillars", "Self-healing film"],
    showInProtectionStep: false,
  }).returning();

  console.log("Services seeded.");

  // ── ADD-ONS ──────────────────────────────────────────────────

  const addOnDefs: Array<{
    name: string;
    group: string;
    prices: Record<typeof VEHICLE_TYPES[number], number>;
    showInProtectionStep: boolean;
  }> = [
    // Interior Upgrades
    { name: "Pet Hair Removal",               group: "Interior Upgrades", prices: { car: 50,  suv: 60,  truck: 70,  van: 80  }, showInProtectionStep: false },
    { name: "Steam Cleaning Interior",        group: "Interior Upgrades", prices: { car: 40,  suv: 50,  truck: 60,  van: 70  }, showInProtectionStep: false },
    { name: "Shampoo Upholstery",             group: "Interior Upgrades", prices: { car: 30,  suv: 40,  truck: 40,  van: 60  }, showInProtectionStep: false },
    { name: "Headliner Cleaning",             group: "Interior Upgrades", prices: { car: 40,  suv: 50,  truck: 60,  van: 70  }, showInProtectionStep: false },
    { name: "Ozone Treatment / Deodorizer",   group: "Interior Upgrades", prices: { car: 95,  suv: 105, truck: 105, van: 135 }, showInProtectionStep: false },
    { name: "Child Seat Clean & Sanitize",    group: "Interior Upgrades", prices: { car: 10,  suv: 10,  truck: 10,  van: 10  }, showInProtectionStep: false },
    { name: "Additional Mats",                group: "Interior Upgrades", prices: { car: 15,  suv: 15,  truck: 15,  van: 25  }, showInProtectionStep: false },
    { name: "Vivid Interior LVP",             group: "Interior Upgrades", prices: { car: 199, suv: 240, truck: 260, van: 280 }, showInProtectionStep: true  },
    // Exterior Upgrades
    { name: "Headlight Restoration",          group: "Exterior Upgrades", prices: { car: 60,  suv: 60,  truck: 60,  van: 60  }, showInProtectionStep: false },
    { name: "Engine Shampoo",                 group: "Exterior Upgrades", prices: { car: 75,  suv: 85,  truck: 85,  van: 105 }, showInProtectionStep: false },
    { name: "Ceramic Rims",                   group: "Exterior Upgrades", prices: { car: 60,  suv: 70,  truck: 80,  van: 70  }, showInProtectionStep: false },
    { name: "Paint Decontamination",          group: "Exterior Upgrades", prices: { car: 150, suv: 175, truck: 200, van: 200 }, showInProtectionStep: false },
    { name: "Paint Sealant",                  group: "Exterior Upgrades", prices: { car: 150, suv: 175, truck: 200, van: 200 }, showInProtectionStep: false },
    { name: "Minor Scratch/Blemish Correction", group: "Exterior Upgrades", prices: { car: 150, suv: 175, truck: 200, van: 200 }, showInProtectionStep: false },
    { name: "Windshield Hydrophobic Coating", group: "Exterior Upgrades", prices: { car: 120, suv: 140, truck: 160, van: 160 }, showInProtectionStep: false },
    { name: "Soft Top / Tonneau Cover Protection", group: "Exterior Upgrades", prices: { car: 95, suv: 95, truck: 95, van: 95 }, showInProtectionStep: false },
    { name: "Vivid Ceramic Glass - Full Vehicle", group: "Exterior Upgrades", prices: { car: 129, suv: 129, truck: 129, van: 129 }, showInProtectionStep: true  },
    { name: "Windshield Ceramic",             group: "Exterior Upgrades", prices: { car: 89,  suv: 89,  truck: 89,  van: 89  }, showInProtectionStep: true  },
  ];

  let addonOrder = 1;
  for (const def of addOnDefs) {
    const [addon] = await db.insert(addOnsTable).values({
      name: def.name,
      categoryGroup: def.group,
      isActive: true,
      showInProtectionStep: def.showInProtectionStep,
      sortOrder: addonOrder++,
    }).returning();

    await db.insert(addOnPricesTable).values(
      VEHICLE_TYPES.map(vt => ({
        addOnId: addon.id,
        vehicleType: vt,
        price: String(def.prices[vt]),
      }))
    );
  }

  console.log("Add-ons seeded.");
  console.log("Database seeded successfully.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
