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
