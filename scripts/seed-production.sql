-- ============================================================
-- Vivid Detailing — Production Seed Script
-- Run this on your Supabase database (SQL Editor or psql)
-- ============================================================

-- ── Schema ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "service_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_id" uuid NOT NULL,
  "vehicle_type" text NOT NULL,
  "price" numeric(10, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS "services" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "pricing_rule" text NOT NULL,
  "base_price" numeric(10, 2),
  "is_active" boolean DEFAULT true NOT NULL,
  "is_seasonal" boolean DEFAULT false NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "description" text,
  "includes" text[] DEFAULT '{}' NOT NULL,
  "show_in_protection_step" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "add_on_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "add_on_id" uuid NOT NULL,
  "vehicle_type" text NOT NULL,
  "price" numeric(10, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS "add_ons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "category_group" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "show_in_protection_step" boolean DEFAULT false NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text,
  "email" text,
  "phone" text,
  "ghl_contact_id" text,
  "ghl_opportunity_id" text,
  "ghl_last_sync" timestamp with time zone,
  "ghl_sync_status" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "vehicles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid,
  "type" text NOT NULL,
  "year" integer,
  "make" text,
  "model" text,
  "colour" text,
  "license_plate" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vehicle_type_check" CHECK ("vehicles"."type" IN ('car','suv','truck','van'))
);

CREATE TABLE IF NOT EXISTS "booking_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL,
  "item_type" text NOT NULL,
  "item_name" text NOT NULL,
  "unit_price" numeric(10, 2),
  "quantity" integer DEFAULT 1 NOT NULL,
  "is_quote_based" boolean DEFAULT false NOT NULL,
  CONSTRAINT "booking_item_type_check" CHECK ("booking_items"."item_type" IN ('service','addon','quote','promo'))
);

CREATE TABLE IF NOT EXISTS "bookings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid,
  "vehicle_id" uuid,
  "status" text DEFAULT 'pending' NOT NULL,
  "appointment_at" timestamp with time zone,
  "total_estimate" numeric(10, 2),
  "deposit_paid" boolean DEFAULT false NOT NULL,
  "notes" text,
  "ghl_contact_id" text,
  "ghl_opportunity_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "booking_status_check" CHECK ("bookings"."status" IN ('pending','confirmed','completed','cancelled'))
);

CREATE TABLE IF NOT EXISTS "quote_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid,
  "vehicle_id" uuid,
  "service_type" text NOT NULL,
  "coverage_option" text,
  "notes" text,
  "photo_urls" text[] DEFAULT '{}' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "seasonal_promos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "base_price" numeric(10, 2) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "valid_from" date,
  "valid_to" date,
  "description" text,
  "includes" text[] DEFAULT '{}' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ghl_sync_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid,
  "booking_id" uuid,
  "event_type" text NOT NULL,
  "payload" text,
  "response" text,
  "status" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "loyalty_activity" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid,
  "booking_id" uuid,
  "spend_amount" numeric(10, 2) NOT NULL,
  "tier_at_time" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "service_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid,
  "booking_id" uuid,
  "condition_score" integer,
  "before_photo_urls" text[] DEFAULT '{}' NOT NULL,
  "after_photo_urls" text[] DEFAULT '{}' NOT NULL,
  "notes" text,
  "completed_at" timestamp with time zone,
  "drive_folder_url" text,
  CONSTRAINT "condition_score_check" CHECK ("service_history"."condition_score" BETWEEN 0 AND 100)
);

-- Foreign keys (safe to run even if they already exist via IF NOT EXISTS workaround)
DO $$ BEGIN
  ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_service_id_services_id_fk"
    FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "add_on_prices" ADD CONSTRAINT "add_on_prices_add_on_id_add_ons_id_fk"
    FOREIGN KEY ("add_on_id") REFERENCES "add_ons"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_customer_id_customers_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_bookings_id_fk"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicle_id_vehicles_id_fk"
    FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "loyalty_activity" ADD CONSTRAINT "loyalty_activity_customer_id_customers_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "service_history" ADD CONSTRAINT "service_history_customer_id_customers_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "service_history" ADD CONSTRAINT "service_history_booking_id_bookings_id_fk"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Services ─────────────────────────────────────────────────

INSERT INTO services (id, name, category, pricing_rule, base_price, is_active, is_seasonal, sort_order, description, includes, show_in_protection_step) VALUES
  ('9bf039c4-714d-458e-b3aa-6b099734a520', 'Vivid Interior', 'detailing', 'vehicle_multiplier_round5', 175.00, true, false, 1,
   'Deep interior detail — seats, carpets, dash, panels, and glass cleaned to a showroom finish.',
   ARRAY['Seat extraction & shampoo','Carpet shampoo','Leather conditioning','Vent cleaning','Full glass clean'], false),

  ('5b10b59d-fa36-47e3-86cc-34e6a5bddeb8', 'Vivid Luster', 'detailing', 'vehicle_multiplier_round5', 249.00, true, false, 2,
   'Complete exterior detail — hand wash, clay bar, tire shine, and spray wax for a showroom-ready shine.',
   ARRAY['Hand wash & dry','Clay bar decontamination','Tire & wheel cleaning','Spray wax','Exterior glass clean'], false),

  ('50dbbb95-29a5-4b30-92d2-9e6fb5f325f9', 'Vivid Glow', 'detailing', 'vehicle_multiplier_round5', 299.00, true, false, 3,
   'Full interior + exterior detail with a single-stage paint enhancement for a deeper, glossier finish.',
   ARRAY['Everything in Vivid Luster','Single-stage machine polish','Paint decontamination','Interior detail','Tire dressing'], false),

  ('aa1831a6-0aaa-4aac-995f-7a9d1092c021', 'Summer Special Ceramic Exterior', 'seasonal', 'flat', 249.00, true, true, 4,
   '1-year ceramic exterior protection at a summer-exclusive flat rate. Any vehicle, one price.',
   ARRAY['Exterior wash','Paint decontamination','Ceramic (painted surfaces)','1-year protection','Free maintenance wash'], false),

  ('4ad8f8fe-73f2-4c15-8c5d-c5bc9cf7f486', 'Vivid Ceramic Gloss Pro', 'ceramic', 'vehicle_multiplier_round5', 299.00, true, false, 5,
   'Entry-level professional ceramic coating with 1-year durability. Hydrophobic, scratch-resistant, gloss-enhancing.',
   ARRAY['Paint decontamination','Ceramic coating (painted surfaces)','1-year protection','Hydrophobic finish'], false),

  ('c7865da3-22e1-403c-9fcf-18a984cac2e4', 'Vivid Ceramic Guard', 'ceramic', 'vehicle_multiplier_round5', 999.00, true, false, 6,
   '3-year ceramic protection with a single-stage paint enhancement. Covers paint, trim, and glass surfaces.',
   ARRAY['Decontamination wash','Single-stage paint enhancement','Ceramic (paint + trim)','3-year protection'], false),

  ('348cfeaa-d2dc-4d32-807b-ed8d23ea6f62', 'Vivid Ceramic Elite Guard', 'ceramic', 'admin_configurable', 1299.00, true, false, 7,
   'Our most comprehensive ceramic package — 5-year durability covering paint, trim, and glass.',
   ARRAY['Everything in Ceramic Guard','5-year ceramic durability','Premium paint enhancement','Glass ceramic included'], false),

  ('4ed7e21f-df40-4880-b027-d0d5db98c512', 'Vivid Ceramic Tint - Rear', 'tint', 'flat', 275.00, true, false, 8,
   'Nano ceramic IR tint on back windows and rear windshield. Lifetime warranty.',
   ARRAY['Back side windows','Rear windshield','Nano ceramic IR film','Lifetime warranty'], false),

  ('b41f24f2-c037-4c24-a5c7-d8a730eb36d8', 'Vivid Ceramic Tint - Full', 'tint', 'flat', 350.00, true, false, 9,
   'Full vehicle nano ceramic IR tint — rear + all front side windows. Lifetime warranty.',
   ARRAY['All side windows','Rear windshield','Nano ceramic IR film','Lifetime warranty'], false),

  ('c7a5a0ee-0e8b-42ea-ae7d-4c16afae50bb', 'Windshield Eyebrow Tint', 'tint', 'flat', 50.00, true, false, 10,
   'A tinted visor strip along the top of the windshield to cut sun glare.',
   ARRAY['Top 6" windshield strip','Carbon or ceramic film','Lifetime warranty'], false),

  ('d76dcd6a-c0bb-4652-8aed-1e6f3cffb2fa', 'Paint Correction', 'paint_correction', 'quote_based', NULL, true, false, 11,
   'Single or multi-stage machine polishing to remove swirl marks, scratches, and oxidation. Priced after inspection.',
   ARRAY['Paint decontamination','Machine polish','Before/after photos','Quote-based pricing'], false),

  ('9530c6d5-946b-427e-a42c-3487accd38ad', 'PPF - Full Front', 'ppf', 'quote_based', NULL, true, false, 12,
   'Paint Protection Film on the full front end — hood, fenders, mirrors, bumper, A-pillars.',
   ARRAY['Hood','Fenders','Front bumper','Side mirrors','A-pillars','Self-healing film'], false)

ON CONFLICT (id) DO NOTHING;

-- ── Service Prices ───────────────────────────────────────────

INSERT INTO service_prices (id, service_id, vehicle_type, price) VALUES
  -- Vivid Interior
  ('55ebb3b7-37db-4a1a-b6e2-68f89b890594','9bf039c4-714d-458e-b3aa-6b099734a520','car',189.00),
  ('14775377-cd24-4009-ac4b-f0ec77286f4b','9bf039c4-714d-458e-b3aa-6b099734a520','suv',209.00),
  ('c53e9cfa-f70d-4560-9797-6b7d8a19f8e7','9bf039c4-714d-458e-b3aa-6b099734a520','truck',229.00),
  ('9bfcd45a-cfc6-4031-b3fe-63e75b52bcb5','9bf039c4-714d-458e-b3aa-6b099734a520','van',249.00),
  -- Vivid Luster
  ('d41e941c-2f36-4387-97a4-2f0fae4817e3','5b10b59d-fa36-47e3-86cc-34e6a5bddeb8','car',219.00),
  ('d19dbd0c-13ff-429e-b7a1-e579ab4c5d5a','5b10b59d-fa36-47e3-86cc-34e6a5bddeb8','suv',239.00),
  ('8fc25345-bf45-48bf-92b5-bf93b4502198','5b10b59d-fa36-47e3-86cc-34e6a5bddeb8','truck',259.00),
  ('ff714a86-ae52-48d2-99f5-9146a151950e','5b10b59d-fa36-47e3-86cc-34e6a5bddeb8','van',279.00),
  -- Vivid Glow
  ('099616d6-f56f-4582-b69c-1cf8214e5dfa','50dbbb95-29a5-4b30-92d2-9e6fb5f325f9','car',329.00),
  ('e8b3ebc0-9ed4-4541-8084-e9acda502c83','50dbbb95-29a5-4b30-92d2-9e6fb5f325f9','suv',349.00),
  ('7570ed73-0c13-4e83-be7f-e1bb8f92de97','50dbbb95-29a5-4b30-92d2-9e6fb5f325f9','truck',369.00),
  ('c7ee20a6-88fa-4f41-a1a1-2eda1df549ca','50dbbb95-29a5-4b30-92d2-9e6fb5f325f9','van',389.00),
  -- Summer Special Ceramic Exterior (flat — same price for all)
  ('e27619e0-9e2b-4230-9798-d2f8a7d9d992','aa1831a6-0aaa-4aac-995f-7a9d1092c021','car',249.00),
  ('d34f409f-b058-42a3-b099-377de63c7d85','aa1831a6-0aaa-4aac-995f-7a9d1092c021','suv',249.00),
  ('b8929057-9cad-4a97-a0b3-9c0b82a8865d','aa1831a6-0aaa-4aac-995f-7a9d1092c021','truck',249.00),
  ('098ed1d4-5ee2-4c9a-a918-42b9d8a34f40','aa1831a6-0aaa-4aac-995f-7a9d1092c021','van',249.00),
  -- Vivid Ceramic Gloss Pro
  ('965b7367-b37f-4ef6-b6bb-6b8e311ebbe3','4ad8f8fe-73f2-4c15-8c5d-c5bc9cf7f486','car',299.00),
  ('e70b90f5-31ed-465b-abc2-d935a572ddf9','4ad8f8fe-73f2-4c15-8c5d-c5bc9cf7f486','suv',360.00),
  ('58bdae6f-4e0b-4a5a-9a5d-c7326691edd9','4ad8f8fe-73f2-4c15-8c5d-c5bc9cf7f486','truck',390.00),
  ('84e5a8bc-156a-496b-95ca-20bcd34a5b2e','4ad8f8fe-73f2-4c15-8c5d-c5bc9cf7f486','van',420.00),
  -- Vivid Ceramic Guard
  ('73c1870b-84be-4d1c-81ef-6e744e9ca77d','c7865da3-22e1-403c-9fcf-18a984cac2e4','car',999.00),
  ('9179b7d2-882a-448c-83a7-12dc5231e009','c7865da3-22e1-403c-9fcf-18a984cac2e4','suv',1200.00),
  ('792ccc00-854c-4352-a523-6435843484d6','c7865da3-22e1-403c-9fcf-18a984cac2e4','truck',1300.00),
  ('1c4779a2-e86c-4fa7-8772-3eeef7ea474a','c7865da3-22e1-403c-9fcf-18a984cac2e4','van',1400.00),
  -- Vivid Ceramic Elite Guard
  ('228a737f-a9ad-41af-8fdf-c8bd4ea885e9','348cfeaa-d2dc-4d32-807b-ed8d23ea6f62','car',1299.00),
  ('4492d048-ee3f-425a-8fae-d48032032d9d','348cfeaa-d2dc-4d32-807b-ed8d23ea6f62','suv',1500.00),
  ('82b6b0e6-4696-4620-a17c-ffbff67c58d0','348cfeaa-d2dc-4d32-807b-ed8d23ea6f62','truck',1600.00),
  ('40f193a9-507c-4943-96f4-cf21d9c967b3','348cfeaa-d2dc-4d32-807b-ed8d23ea6f62','van',1700.00),
  -- Vivid Ceramic Tint - Rear (flat)
  ('22c3c80c-c5c1-4e39-a309-a5bfc563c45b','4ed7e21f-df40-4880-b027-d0d5db98c512','car',275.00),
  ('6b42ebba-6d50-4856-ae4c-780c384635ac','4ed7e21f-df40-4880-b027-d0d5db98c512','suv',275.00),
  ('ffa3406c-cf5c-475e-a281-891bd0528250','4ed7e21f-df40-4880-b027-d0d5db98c512','truck',275.00),
  ('bf103933-9bff-4666-8361-6b959fdb8844','4ed7e21f-df40-4880-b027-d0d5db98c512','van',275.00),
  -- Vivid Ceramic Tint - Full (flat)
  ('27b617fb-e4de-45bc-a66a-c40ef394b08b','b41f24f2-c037-4c24-a5c7-d8a730eb36d8','car',350.00),
  ('2a3b07a6-6d73-498c-bacc-59b38c791211','b41f24f2-c037-4c24-a5c7-d8a730eb36d8','suv',350.00),
  ('febb20bb-0622-4455-938b-d2956a352b09','b41f24f2-c037-4c24-a5c7-d8a730eb36d8','truck',350.00),
  ('f5e919d7-49c2-4a4e-b1af-153a99fc4d55','b41f24f2-c037-4c24-a5c7-d8a730eb36d8','van',350.00),
  -- Windshield Eyebrow Tint (flat)
  ('b858b0dd-2e8e-4362-ae9a-17ef585e00bc','c7a5a0ee-0e8b-42ea-ae7d-4c16afae50bb','car',50.00),
  ('ebc705b7-98f2-4942-9ec0-eccfeced8b4b','c7a5a0ee-0e8b-42ea-ae7d-4c16afae50bb','suv',50.00),
  ('c440cf76-bb5b-428a-8553-ba74d9ccd85f','c7a5a0ee-0e8b-42ea-ae7d-4c16afae50bb','truck',50.00),
  ('45fffb3e-042d-44c3-bd25-6581cae093d7','c7a5a0ee-0e8b-42ea-ae7d-4c16afae50bb','van',50.00)

ON CONFLICT (id) DO NOTHING;

-- ── Add-ons ──────────────────────────────────────────────────

INSERT INTO add_ons (id, name, category_group, is_active, show_in_protection_step, sort_order) VALUES
  ('a40bbaf7-d6f7-4879-ad50-56a8f80b0fb6', 'Pet Hair Removal',                    'Interior Upgrades', true, false,  1),
  ('41675c62-e987-46cc-a9d8-7957548f4be1', 'Steam Cleaning Interior',             'Interior Upgrades', true, false,  2),
  ('a6a827f6-b707-4fc9-9e81-136c433e302e', 'Shampoo Upholstery',                  'Interior Upgrades', true, false,  3),
  ('3dd78a4e-62f2-4e4d-b7e8-e657931bfb0b', 'Headliner Cleaning',                  'Interior Upgrades', true, false,  4),
  ('91e3ad69-dcb0-48e6-825e-af90a24fd668', 'Ozone Treatment / Deodorizer',        'Interior Upgrades', true, false,  5),
  ('1038039f-35af-4fb1-8ffe-9c46576907fa', 'Child Seat Clean & Sanitize',         'Interior Upgrades', true, false,  6),
  ('e5b6018d-d241-4feb-b942-1249792bde5d', 'Additional Mats',                     'Interior Upgrades', true, false,  7),
  ('ab4c7edb-cf90-4ac0-a73a-fe366a9ca597', 'Vivid Interior Ceramic Leather',      'Interior Upgrades', true, true,   8),
  ('251e4384-311c-46eb-b972-e77c2fc5befd', 'Headlight Restoration',               'Exterior Upgrades', true, false,  9),
  ('12142c08-b70c-4849-b6fb-e8b4c3789f89', 'Engine Shampoo',                      'Exterior Upgrades', true, false, 10),
  ('cbb13b45-b7a8-4b00-a6aa-481dba9d36ab', 'Ceramic Rims',                        'Exterior Upgrades', true, false, 11),
  ('4620fd75-1514-421e-8625-230bfc994296', 'Paint Decontamination',               'Exterior Upgrades', true, false, 12),
  ('498c6d7f-4d6d-43a8-a145-c79a4fe61eb2', 'Paint Sealant',                       'Exterior Upgrades', true, false, 13),
  ('034bdd6e-5f2d-4450-bb6d-93fd9778bb7b', 'Minor Scratch/Blemish Correction',    'Exterior Upgrades', true, false, 14),
  ('3e1a9353-d26f-4480-b496-290b30066050', 'Windshield Hydrophobic Coating',      'Exterior Upgrades', true, false, 15),
  ('14a0e66c-0835-4faa-b0e1-447aa27822ea', 'Soft Top / Tonneau Cover Protection', 'Exterior Upgrades', true, false, 16),
  ('b7bd4dba-b791-488e-9d28-42cb0b07d77d', 'Vivid Ceramic Glass - Full Vehicle',  'Exterior Upgrades', true, true,  17),
  ('e14b6b20-1f15-4c76-a2a8-230bc4fa6623', 'Windshield Ceramic',                  'Exterior Upgrades', true, true,  18)

ON CONFLICT (id) DO NOTHING;

-- ── Add-on Prices ────────────────────────────────────────────

INSERT INTO add_on_prices (id, add_on_id, vehicle_type, price) VALUES
  -- Pet Hair Removal
  ('5b64d6da-abad-4212-959c-69db4fb5f387','a40bbaf7-d6f7-4879-ad50-56a8f80b0fb6','car',50.00),
  ('68ee2c11-98c0-463c-97a4-bebcd55cb922','a40bbaf7-d6f7-4879-ad50-56a8f80b0fb6','suv',60.00),
  ('0fc0fd26-99c4-4379-ac63-548f2fd2b6d9','a40bbaf7-d6f7-4879-ad50-56a8f80b0fb6','truck',70.00),
  ('5cd91146-26ea-49cd-89e0-fac6afed1002','a40bbaf7-d6f7-4879-ad50-56a8f80b0fb6','van',80.00),
  -- Steam Cleaning Interior
  ('dc0bcc44-a630-44a7-a883-2291b55b5b9f','41675c62-e987-46cc-a9d8-7957548f4be1','car',40.00),
  ('55517e9d-f3ca-497f-a0d3-a6384b76c1d5','41675c62-e987-46cc-a9d8-7957548f4be1','suv',50.00),
  ('2a824634-0c5b-40ca-973e-27e38f3fac13','41675c62-e987-46cc-a9d8-7957548f4be1','truck',60.00),
  ('e5e06c45-60d6-4bad-828d-4f439d23745b','41675c62-e987-46cc-a9d8-7957548f4be1','van',70.00),
  -- Shampoo Upholstery
  ('162ce6d7-694e-48dd-90ff-f48ad8ef5705','a6a827f6-b707-4fc9-9e81-136c433e302e','car',95.00),
  ('843eb4b1-5d3d-48e6-b3d1-4e8f6a50e422','a6a827f6-b707-4fc9-9e81-136c433e302e','suv',105.00),
  ('037da576-7d2c-481d-b124-36a4f41c11df','a6a827f6-b707-4fc9-9e81-136c433e302e','truck',105.00),
  ('f67da140-1fe2-4176-b9a0-bbedf20172ac','a6a827f6-b707-4fc9-9e81-136c433e302e','van',135.00),
  -- Headliner Cleaning
  ('c5456841-08ad-40e9-be11-95b077a8e9e6','3dd78a4e-62f2-4e4d-b7e8-e657931bfb0b','car',40.00),
  ('308a2a1a-034b-4e88-bb17-ad51ffb4b6f6','3dd78a4e-62f2-4e4d-b7e8-e657931bfb0b','suv',50.00),
  ('ec7f4c90-1c69-43de-a732-75e4839e304f','3dd78a4e-62f2-4e4d-b7e8-e657931bfb0b','truck',60.00),
  ('372e0c61-ea82-4122-8bca-6c1642b330ba','3dd78a4e-62f2-4e4d-b7e8-e657931bfb0b','van',70.00),
  -- Ozone Treatment
  ('fde83efd-e34d-4cb4-8256-c6cb8e967e69','91e3ad69-dcb0-48e6-825e-af90a24fd668','car',95.00),
  ('9ca50dbd-58a8-4108-9dae-c7d1fca4790a','91e3ad69-dcb0-48e6-825e-af90a24fd668','suv',105.00),
  ('b970d226-1cf3-4581-ab61-48c615db1dab','91e3ad69-dcb0-48e6-825e-af90a24fd668','truck',105.00),
  ('1c25c217-d129-4897-b12c-1ffb172e2635','91e3ad69-dcb0-48e6-825e-af90a24fd668','van',135.00),
  -- Child Seat Clean & Sanitize
  ('01961c9b-086a-407e-b1cf-a9779a127400','1038039f-35af-4fb1-8ffe-9c46576907fa','car',10.00),
  ('895ef752-26b0-4d2b-bbbc-3ba98c4ad7ec','1038039f-35af-4fb1-8ffe-9c46576907fa','suv',10.00),
  ('678bfb13-0346-461b-8e21-0ace010033fd','1038039f-35af-4fb1-8ffe-9c46576907fa','truck',10.00),
  ('e00630eb-772c-4d4a-8e91-7776202bfd60','1038039f-35af-4fb1-8ffe-9c46576907fa','van',10.00),
  -- Vivid Interior Ceramic Leather
  ('0db538eb-b6cf-4fbb-898e-65448e86392f','ab4c7edb-cf90-4ac0-a73a-fe366a9ca597','car',199.00),
  ('e8f3cbc3-9c38-4e0f-8d4b-ba731b7b1dfc','ab4c7edb-cf90-4ac0-a73a-fe366a9ca597','suv',240.00),
  ('6edb6212-c45c-440f-8cb1-4b2c10a5d2c8','ab4c7edb-cf90-4ac0-a73a-fe366a9ca597','truck',260.00),
  ('e1ac04a2-a323-4250-916c-2ef3558b04df','ab4c7edb-cf90-4ac0-a73a-fe366a9ca597','van',280.00),
  -- Headlight Restoration
  ('4baf1589-4fff-43dc-83a6-65115947e2c3','251e4384-311c-46eb-b972-e77c2fc5befd','car',60.00),
  ('7feda9f0-1a54-4a9c-974f-ca5f895d3fe2','251e4384-311c-46eb-b972-e77c2fc5befd','suv',60.00),
  ('e7501a07-3575-41ad-9fa9-afd11aef8468','251e4384-311c-46eb-b972-e77c2fc5befd','truck',60.00),
  ('85230308-8062-4796-84d7-c4eacd40313a','251e4384-311c-46eb-b972-e77c2fc5befd','van',60.00),
  -- Engine Shampoo
  ('eeb03281-4fd9-460c-bddb-b995b3ab7e44','12142c08-b70c-4849-b6fb-e8b4c3789f89','car',75.00),
  ('050e58bd-d65e-4559-b48d-ba7d2e934c67','12142c08-b70c-4849-b6fb-e8b4c3789f89','suv',85.00),
  ('f52cee3f-d14f-48e0-9939-2b9f42caeeed','12142c08-b70c-4849-b6fb-e8b4c3789f89','truck',85.00),
  ('64c7785d-3fc5-4e3b-b520-e27df46c1b64','12142c08-b70c-4849-b6fb-e8b4c3789f89','van',105.00),
  -- Ceramic Rims
  ('12d2ba12-e60a-4788-b421-5e1868cd6813','cbb13b45-b7a8-4b00-a6aa-481dba9d36ab','car',60.00),
  ('62a488a3-e57f-4901-be25-519600024743','cbb13b45-b7a8-4b00-a6aa-481dba9d36ab','suv',70.00),
  ('214001bd-af67-46c7-92cc-489ef967e227','cbb13b45-b7a8-4b00-a6aa-481dba9d36ab','truck',80.00),
  ('55d8c13d-2ad4-475c-a9e6-372e905f765d','cbb13b45-b7a8-4b00-a6aa-481dba9d36ab','van',70.00),
  -- Paint Decontamination
  ('931bad8c-1b82-4084-a453-a31c8039020d','4620fd75-1514-421e-8625-230bfc994296','car',150.00),
  ('030e96e4-bebc-4e7e-a3f3-42545b01a985','4620fd75-1514-421e-8625-230bfc994296','suv',175.00),
  ('3f7f3d52-1445-40ec-8f99-84040071113f','4620fd75-1514-421e-8625-230bfc994296','truck',200.00),
  ('24606bc0-3f6d-4b7e-a4a9-2df62aa9331e','4620fd75-1514-421e-8625-230bfc994296','van',200.00),
  -- Paint Sealant
  ('f815da4e-1b46-47cc-828e-dd6297563e64','498c6d7f-4d6d-43a8-a145-c79a4fe61eb2','car',150.00),
  ('40ff7246-9a24-4a22-9394-7015faccb373','498c6d7f-4d6d-43a8-a145-c79a4fe61eb2','suv',175.00),
  ('16b6560d-1440-4d0f-a83c-aa9d649063df','498c6d7f-4d6d-43a8-a145-c79a4fe61eb2','truck',200.00),
  ('b9dcb10e-31eb-4e75-b37c-53441ce29086','498c6d7f-4d6d-43a8-a145-c79a4fe61eb2','van',200.00),
  -- Minor Scratch/Blemish Correction
  ('faa49de6-091f-48b8-97e1-a2362633489e','034bdd6e-5f2d-4450-bb6d-93fd9778bb7b','car',150.00),
  ('e916dae5-db24-4eb9-ab6f-f89fdbd9f541','034bdd6e-5f2d-4450-bb6d-93fd9778bb7b','suv',175.00),
  ('ab2b0f88-29f1-4340-8840-933d08abd305','034bdd6e-5f2d-4450-bb6d-93fd9778bb7b','truck',200.00),
  ('464fbc30-5a44-4bc7-81fb-ede51f0714d4','034bdd6e-5f2d-4450-bb6d-93fd9778bb7b','van',200.00),
  -- Windshield Hydrophobic Coating
  ('f93335ae-655f-4d35-9a8d-cee26c49690b','3e1a9353-d26f-4480-b496-290b30066050','car',120.00),
  ('eb36c612-622c-4603-8410-4e3319d6b74a','3e1a9353-d26f-4480-b496-290b30066050','suv',140.00),
  ('ddd2f967-6c89-43e0-aa48-6008d7dff151','3e1a9353-d26f-4480-b496-290b30066050','truck',160.00),
  ('e4751ce2-ac14-40e5-9174-0b2b01c2cd0d','3e1a9353-d26f-4480-b496-290b30066050','van',160.00),
  -- Soft Top / Tonneau Cover Protection
  ('a5ef7da8-7216-403d-baa6-6e25017b472d','14a0e66c-0835-4faa-b0e1-447aa27822ea','car',95.00),
  ('5233ba52-485b-4b5d-8980-c1e562cad7d0','14a0e66c-0835-4faa-b0e1-447aa27822ea','suv',95.00),
  ('093d2c7a-5723-44ec-83d8-6b60374d4828','14a0e66c-0835-4faa-b0e1-447aa27822ea','truck',95.00),
  ('edd63f4d-f95d-401e-acbc-2b4d4408bd41','14a0e66c-0835-4faa-b0e1-447aa27822ea','van',95.00),
  -- Vivid Ceramic Glass - Full Vehicle
  ('97f821cf-f419-4f9c-8ecf-42d6f73b5fc7','b7bd4dba-b791-488e-9d28-42cb0b07d77d','car',129.00),
  ('605c56df-0e44-46b2-a3b6-09d7794683c7','b7bd4dba-b791-488e-9d28-42cb0b07d77d','suv',129.00),
  ('38ec6a8e-8520-4ea2-94d5-bfc99dfaedcb','b7bd4dba-b791-488e-9d28-42cb0b07d77d','truck',129.00),
  ('878f4359-3547-44da-b480-f1d135a06e5e','b7bd4dba-b791-488e-9d28-42cb0b07d77d','van',129.00),
  -- Windshield Ceramic
  ('d7d13247-d973-4e71-b3c6-b59aa5fc4f0f','e14b6b20-1f15-4c76-a2a8-230bc4fa6623','car',99.00),
  ('bc7ef1a2-5513-4b6c-9ee4-f8d2a3c01234','e14b6b20-1f15-4c76-a2a8-230bc4fa6623','suv',99.00),
  ('ef3a9012-7845-4c2d-b1f3-a9e4d5678901','e14b6b20-1f15-4c76-a2a8-230bc4fa6623','truck',99.00),
  ('fa1b2345-8956-4d3e-c2f4-b0f5e6789012','e14b6b20-1f15-4c76-a2a8-230bc4fa6623','van',99.00)

ON CONFLICT (id) DO NOTHING;
