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

  // Clear existing data
  await db.delete(servicePricesTable);
  await db.delete(addOnPricesTable);
  await db.delete(servicesTable);
  await db.delete(addOnsTable);
  await db.delete(seasonalPromosTable);

  // ── SERVICES ──────────────────────────────────────────────────

  // 1. Maintenance Wash & Detail (flat)
  const [mwd] = await db
    .insert(servicesTable)
    .values({
      name: "Maintenance Wash & Detail",
      category: "detailing",
      pricingRule: "flat",
      basePrice: "89",
      isActive: true,
      isSeasonal: false,
      sortOrder: 1,
      description: "Full exterior wash, interior vacuum, wipe-down, tire dressing, and windows.",
      includes: ["Hand wash", "Interior vacuum", "Dash & console wipe-down", "Window cleaning", "Tire dressing"],
      showInProtectionStep: false,
    })
    .returning();

  // 2. Full Interior Detail (vehicle_multiplier_round5)
  const [fid] = await db
    .insert(servicesTable)
    .values({
      name: "Full Interior Detail",
      category: "detailing",
      pricingRule: "vehicle_multiplier_round5",
      basePrice: "175",
      isActive: true,
      isSeasonal: false,
      sortOrder: 2,
      description: "Deep clean every surface inside your vehicle — seats, carpets, dash, panels, and glass.",
      includes: ["Seat extraction & shampoo", "Carpet shampoo", "Leather conditioning", "Vent cleaning", "Headliner wipe", "Full glass"],
      showInProtectionStep: false,
    })
    .returning();

  await db.insert(servicePricesTable).values([
    { serviceId: fid.id, vehicleType: "car", price: "175" },
    { serviceId: fid.id, vehicleType: "suv", price: "210" },
    { serviceId: fid.id, vehicleType: "truck", price: "230" },
    { serviceId: fid.id, vehicleType: "van", price: "245" },
  ]);

  // 3. Full Detail Package (vehicle_multiplier_round5)
  const [fdp] = await db
    .insert(servicesTable)
    .values({
      name: "Full Detail Package",
      category: "detailing",
      pricingRule: "vehicle_multiplier_round5",
      basePrice: "249",
      isActive: true,
      isSeasonal: false,
      sortOrder: 3,
      description: "Complete exterior + interior detail. Our most popular service.",
      includes: ["Everything in Interior Detail", "Hand wash & clay bar", "Tire & wheel cleaning", "Exterior spray wax", "Door jamb wipe"],
      showInProtectionStep: false,
    })
    .returning();

  await db.insert(servicePricesTable).values([
    { serviceId: fdp.id, vehicleType: "car", price: "249" },
    { serviceId: fdp.id, vehicleType: "suv", price: "300" },
    { serviceId: fdp.id, vehicleType: "truck", price: "325" },
    { serviceId: fdp.id, vehicleType: "van", price: "345" },
  ]);

  // 4. Ceramic Coating (vehicle_multiplier_round5)
  const [cc] = await db
    .insert(servicesTable)
    .values({
      name: "Ceramic Coating",
      category: "ceramic",
      pricingRule: "vehicle_multiplier_round5",
      basePrice: "799",
      isActive: true,
      isSeasonal: false,
      sortOrder: 4,
      description: "Professional-grade 9H ceramic coating. Hydrophobic protection for 2–5 years.",
      includes: ["Paint decontamination", "Single-stage polish", "Ceramic coating application", "Curing", "2-year protection"],
      showInProtectionStep: true,
    })
    .returning();

  await db.insert(servicePricesTable).values([
    { serviceId: cc.id, vehicleType: "car", price: "799" },
    { serviceId: cc.id, vehicleType: "suv", price: "960" },
    { serviceId: cc.id, vehicleType: "truck", price: "1040" },
    { serviceId: cc.id, vehicleType: "van", price: "1120" },
  ]);

  // 5. Window Tint – Full (fixed_by_vehicle_type)
  const [wtf] = await db
    .insert(servicesTable)
    .values({
      name: "Window Tint – Full",
      category: "tint",
      pricingRule: "fixed_by_vehicle_type",
      basePrice: null,
      isActive: true,
      isSeasonal: false,
      sortOrder: 5,
      description: "Full vehicle window tint using premium carbon or ceramic film. UV blocking, heat rejection.",
      includes: ["All side windows", "Rear window", "Film warranty"],
      showInProtectionStep: false,
    })
    .returning();

  await db.insert(servicePricesTable).values([
    { serviceId: wtf.id, vehicleType: "car", price: "299" },
    { serviceId: wtf.id, vehicleType: "suv", price: "349" },
    { serviceId: wtf.id, vehicleType: "truck", price: "329" },
    { serviceId: wtf.id, vehicleType: "van", price: "379" },
  ]);

  // 6. Window Tint – Rear Only (fixed_by_vehicle_type)
  const [wtr] = await db
    .insert(servicesTable)
    .values({
      name: "Window Tint – Rear Only",
      category: "tint",
      pricingRule: "fixed_by_vehicle_type",
      basePrice: null,
      isActive: true,
      isSeasonal: false,
      sortOrder: 6,
      description: "Rear window and rear side windows only. Great for privacy and UV protection.",
      includes: ["Rear window", "Rear side windows", "Film warranty"],
      showInProtectionStep: false,
    })
    .returning();

  await db.insert(servicePricesTable).values([
    { serviceId: wtr.id, vehicleType: "car", price: "199" },
    { serviceId: wtr.id, vehicleType: "suv", price: "229" },
    { serviceId: wtr.id, vehicleType: "truck", price: "219" },
    { serviceId: wtr.id, vehicleType: "van", price: "249" },
  ]);

  // 7. Paint Correction (quote_based)
  const [pc] = await db
    .insert(servicesTable)
    .values({
      name: "Paint Correction",
      category: "paint_correction",
      pricingRule: "quote_based",
      basePrice: null,
      isActive: true,
      isSeasonal: false,
      sortOrder: 7,
      description: "Single or multi-stage machine polishing to remove swirl marks, scratches, and oxidation.",
      includes: ["Paint decontamination", "Machine polish", "Before/after photos", "Quote-based pricing"],
      showInProtectionStep: true,
    })
    .returning();

  // 8. PPF – Full Front (quote_based)
  const [ppf] = await db
    .insert(servicesTable)
    .values({
      name: "PPF – Full Front",
      category: "ppf",
      pricingRule: "quote_based",
      basePrice: null,
      isActive: true,
      isSeasonal: false,
      sortOrder: 8,
      description: "Paint Protection Film on the full front end — hood, fenders, mirrors, bumper, A-pillars.",
      includes: ["Hood", "Fenders", "Front bumper", "Side mirrors", "A-pillars", "Self-healing film"],
      showInProtectionStep: true,
    })
    .returning();

  // 9. PPF – Partial Hood (quote_based)
  const [ppfp] = await db
    .insert(servicesTable)
    .values({
      name: "PPF – Partial Hood",
      category: "ppf",
      pricingRule: "quote_based",
      basePrice: null,
      isActive: true,
      isSeasonal: false,
      sortOrder: 9,
      description: "Protect the leading edge and partial hood from rock chips and road debris.",
      includes: ["Partial hood (18\"/24\")", "Front bumper", "Self-healing film", "10-year warranty"],
      showInProtectionStep: false,
    })
    .returning();

  // 10. Headlight Restoration (flat)
  const [hlr] = await db
    .insert(servicesTable)
    .values({
      name: "Headlight Restoration",
      category: "detailing",
      pricingRule: "flat",
      basePrice: "89",
      isActive: true,
      isSeasonal: false,
      sortOrder: 10,
      description: "Polish and seal yellowed or foggy headlights to restore clarity and improve visibility.",
      includes: ["Wet sand & polish", "UV sealant coat", "Both headlights"],
      showInProtectionStep: false,
    })
    .returning();

  // 11. Windshield Eyebrow Tint (flat)
  const [wet] = await db
    .insert(servicesTable)
    .values({
      name: "Windshield Eyebrow Tint",
      category: "tint",
      pricingRule: "flat",
      basePrice: "79",
      isActive: true,
      isSeasonal: false,
      sortOrder: 11,
      description: "A tinted visor strip along the top of the windshield for glare reduction.",
      includes: ["Top 6\" strip", "Carbon or ceramic film", "Lifetime film warranty"],
      showInProtectionStep: false,
    })
    .returning();

  console.log("Services seeded.");

  // ── ADD-ONS ──────────────────────────────────────────────────

  const addOnDefs = [
    // Interior Upgrades
    { name: "Odour Elimination (Ozone)", group: "Interior Upgrades", prices: { car: 49, suv: 59, truck: 59, van: 69 }, showInProtectionStep: false },
    { name: "Leather Conditioning", group: "Interior Upgrades", prices: { car: 39, suv: 49, truck: 49, van: 55 }, showInProtectionStep: false },
    { name: "Stain Guard (Fabric Seats)", group: "Interior Upgrades", prices: { car: 59, suv: 69, truck: 69, van: 79 }, showInProtectionStep: false },
    { name: "Pet Hair Removal", group: "Interior Upgrades", prices: { car: 45, suv: 55, truck: 55, van: 65 }, showInProtectionStep: false },
    { name: "Engine Bay Detailing", group: "Interior Upgrades", prices: { car: 89, suv: 99, truck: 99, van: 109 }, showInProtectionStep: false },
    // Exterior Upgrades
    { name: "Clay Bar Decontamination", group: "Exterior Upgrades", prices: { car: 49, suv: 59, truck: 59, van: 69 }, showInProtectionStep: true },
    { name: "Iron Fallout Removal", group: "Exterior Upgrades", prices: { car: 39, suv: 49, truck: 49, van: 55 }, showInProtectionStep: false },
    { name: "Spray Wax / Paint Sealant", group: "Exterior Upgrades", prices: { car: 59, suv: 69, truck: 69, van: 79 }, showInProtectionStep: true },
    { name: "Wheel & Tire Detail", group: "Exterior Upgrades", prices: { car: 49, suv: 59, truck: 59, van: 69 }, showInProtectionStep: false },
    { name: "Tar & Adhesive Removal", group: "Exterior Upgrades", prices: { car: 45, suv: 55, truck: 55, van: 65 }, showInProtectionStep: false },
    { name: "Convertible Roof Treatment", group: "Exterior Upgrades", prices: { car: 79, suv: 79, truck: 79, van: 79 }, showInProtectionStep: false },
  ];

  let addonOrder = 1;
  for (const def of addOnDefs) {
    const [addon] = await db
      .insert(addOnsTable)
      .values({
        name: def.name,
        categoryGroup: def.group,
        isActive: true,
        showInProtectionStep: def.showInProtectionStep,
        sortOrder: addonOrder++,
      })
      .returning();

    await db.insert(addOnPricesTable).values(
      VEHICLE_TYPES.map((vt) => ({
        addOnId: addon.id,
        vehicleType: vt,
        price: String(def.prices[vt]),
      }))
    );
  }

  console.log("Add-ons seeded.");

  // ── SEASONAL PROMOS ──────────────────────────────────────────

  await db.insert(seasonalPromosTable).values({
    name: "Summer Special Ceramic",
    basePrice: "249",
    isActive: true,
    validFrom: "2025-06-01",
    validTo: "2025-08-31",
    description: "Our signature ceramic coating at a summer-exclusive flat rate. Any vehicle, one price.",
    includes: ["Paint decontamination", "Single-stage polish", "Ceramic coating", "1-year protection", "Free maintenance wash"],
  });

  console.log("Seasonal promos seeded.");
  console.log("Database seeded successfully.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
