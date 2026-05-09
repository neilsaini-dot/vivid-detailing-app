-- Migration: add manual booking fields to bookings table
-- Run this in your Supabase SQL Editor and on Railway before deploying

-- 1. Add source column (booking origin)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'online';

-- 2. Add constraint for valid source values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_source_check'
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT booking_source_check
      CHECK (source IN ('online','phone','walkin','referral','other'));
  END IF;
END $$;

-- 3. Add is_manual_price_override column
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_manual_price_override BOOLEAN NOT NULL DEFAULT false;

-- 4. Add created_by_admin column
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_by_admin BOOLEAN NOT NULL DEFAULT false;

-- 5. Update booking_items type check to allow 'manual' line items
ALTER TABLE booking_items DROP CONSTRAINT IF EXISTS booking_item_type_check;
ALTER TABLE booking_items ADD CONSTRAINT booking_item_type_check
  CHECK (item_type IN ('service','addon','quote','promo','manual'));

-- 6. Add estimated_pickup_at column for per-appointment pickup time
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS estimated_pickup_at TIMESTAMPTZ;

-- 7. Add internal_notes column — admin-only, never exposed to customers
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS internal_notes TEXT;

-- 8. Create booking_drafts table for tracking incomplete booking sessions
CREATE TABLE IF NOT EXISTS booking_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT 'car',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  completed_booking_id UUID
);

-- 9. Create reviews table for customer ratings submitted via email link
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  feedback TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  redirected_to_google BOOLEAN NOT NULL DEFAULT false
);

-- 10. Create supplies table for admin inventory tracking
CREATE TABLE IF NOT EXISTS supplies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  notes TEXT,
  is_low_stock BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. Update booking status check constraint to allow 'in_progress'
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS booking_status_check;
ALTER TABLE bookings ADD CONSTRAINT booking_status_check
  CHECK (status IN ('pending','confirmed','completed','cancelled','in_progress'));

-- 12. Create inspections table for vehicle intake inspection flow
CREATE TABLE IF NOT EXISTS inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  vehicle_snapshot JSONB,
  damage_entries JSONB NOT NULL DEFAULT '[]',
  dashboard_lights JSONB NOT NULL DEFAULT '[]',
  condition_notes TEXT,
  package_override TEXT,
  addons_selected JSONB NOT NULL DEFAULT '[]',
  estimated_pickup_at TIMESTAMPTZ,
  job_notes TEXT,
  before_photo_urls TEXT[] DEFAULT '{}',
  signature_url TEXT,
  client_present BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
