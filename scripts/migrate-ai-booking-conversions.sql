-- Run once in the EXISTING Supabase production database's SQL Editor.
-- Additive only: existing bookings, GHL mappings, and prices are unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS ai_booking_conversions (
  booking_id UUID PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'review' CHECK (state IN ('review', 'processing', 'failed', 'converted')),
  webhook_state TEXT NOT NULL DEFAULT 'pending' CHECK (webhook_state IN ('pending', 'sending', 'sent', 'uncertain')),
  calendar_event_id TEXT,
  claimed_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  last_error TEXT
);
COMMIT;