-- Run against the EXISTING app database before enabling the GoHighLevel workflows.
-- No changes to existing packages, bookings, prices, or constraints.
BEGIN;
CREATE TABLE IF NOT EXISTS ghl_special_appointments (
  location_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  external_contact_id TEXT,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  external_status TEXT NOT NULL,
  appointment_end_at TIMESTAMPTZ,
  external_updated_at TIMESTAMPTZ,
  fingerprint TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (location_id, appointment_id)
);
COMMIT;