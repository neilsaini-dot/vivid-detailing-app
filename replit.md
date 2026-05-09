# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Features

### Admin Manual Booking System
- `POST /api/admin/bookings` — create a booking (customer search/create, vehicle, free-form line items, source, status, total override)
- `GET /api/admin/customers/search?q=` — live customer search by name/email/phone with vehicles
- Source filter on `GET /api/admin/bookings?source=phone|walkin|online|referral|other`
- Colour-coded source badges in bookings table
- If status is `confirmed`, fires GHL webhook + creates Google Calendar event automatically

### Estimated Pickup Time
- `bookings.estimated_pickup_at` (TIMESTAMPTZ) column in DB + OpenAPI schema
- `PATCH /api/admin/bookings/:id` accepts `estimatedPickupAt`; fires `sendGhlPickupTimeSet` webhook non-blockingly when value changes
- BookingDetailSheet: "Est. Pickup Time" datetime-local input + Set button in Appointment & Status section

### Day Availability Check (ManualBookingSheet)
- When appointment date changes, fetches `GET /api/admin/calendar/day-summary?date=YYYY-MM-DD`
- Shows colour-coded indicator: green (0 events), yellow (1-2), red (3+) with event list and times

### Calendar Tab (AdminDashboard)
- New "Calendar" tab between Bookings and Services
- Fetches `GET /api/admin/calendar/events?year=YYYY&month=MM` from Google Calendar
- Monthly grid view: today highlighted, events shown per day cell, prev/next/today navigation

### Sortable Bookings Table + "Booked On" Column
- All columns sortable: date, customer, vehicle, service, source, status, total, booked-on (`createdAt`)
- "Booked On" shows the date the booking record was created (sortable, displayed as MMM d, yyyy)

### Incomplete Bookings Tracking
- `booking_drafts` table: id, name, phone, vehicle_type, started_at, completed_at (nullable), completed_booking_id (nullable)
- `POST /api/bookings/draft` — called non-blockingly after step 1 lead capture in booking form; stores draftId in component state
- `PATCH /api/bookings/draft/:id/complete` — called after successful booking submit to mark draft complete
- `GET /api/admin/booking-drafts` — returns only incomplete (completedAt IS NULL) drafts, newest first
- `DELETE /api/admin/booking-drafts/:id` — dismiss a draft from admin view
- Admin Bookings tab shows a yellow pulsing panel above the table when any incomplete drafts exist; each row shows name, phone, vehicle type, start time, and a dismiss (×) button

### Customer Review & Rating System
- `reviews` table: id, booking_id, customer_id, rating (1–5), feedback, submitted_at, redirected_to_google
- `/review` page (no login): accepts `?rating=N&booking_id=UUID` query params, star selector, feedback textarea
- `POST /api/reviews` — submit a review; returns `{ redirectUrl }` for 4-5 star ratings; blocks duplicates
- `GET /api/reviews/check?bookingId=` — check if already reviewed (used on page load)
- `GET /api/admin/reviews?rating=N` — list reviews with customer name, vehicle, filterable by star
- `GOOGLE_REVIEW_URL` env var — set in Railway; server returns this as `redirectUrl` for 4-5 star submissions
- When booking marked completed, `GhlBookingCompletedPayload.booking.rating_link` = `https://book.vividpei.com/review?booking_id=<id>` for GHL `{{rating_link}}` merge tag
- Admin: new "Reviews" tab with star display, feedback, date, Google redirect badge, filter by rating

### Internal Notes
- `bookings.internal_notes TEXT` column; PATCH endpoint; admin-only UI with yellow "Admin only" badge

### Vehicle Intake Inspection Flow
- `inspections` table: id, booking_id, vehicle_snapshot (jsonb), damage_entries (jsonb), dashboard_lights (jsonb), condition_notes, package_override, addons_selected (jsonb), estimated_pickup_at, job_notes, before_photo_urls (text[]), signature_url, client_present, status (draft/completed), completed_at, created_at
- `GET /api/admin/inspections/booking/:bookingId` — fetch inspection for a booking (null if none)
- `POST /api/admin/inspections` — create or return existing inspection (idempotent)
- `PATCH /api/admin/inspections/:id` — auto-save inspection data between steps
- `POST /api/admin/inspections/:id/complete` — mark inspection completed + set booking status to in_progress
- 5-step full-screen overlay: Customer & Vehicle, Vehicle Condition (SVG diagram zones A–O, damage type/severity, dashboard lights), Job Details (package/addons selector with running total incl. HST), Before Photos (upload grid), Sign Off (disclaimer, signature canvas)
- View-only summary for completed inspections with Print button (`window.print()`)
- `booking_status_check` constraint updated to include `in_progress`
- `supabaseStorage.ts` extended with `"signature"` photoType → fixed path `customerId/bookingId/signature/signature.png`
- Admin BookingDetailSheet: shows Start/Continue/View Inspection button; `in_progress` status badge (sky blue); status dropdown includes In Progress
- Bookings "Scheduled" view filter includes `in_progress` bookings

### Supplies Inventory Tab
- `supplies` table: id, name, category, notes, is_low_stock, sort_order, last_updated
- `GET /api/admin/supplies` — list all supplies sorted by sort_order
- `POST /api/admin/supplies` — create supply (name, category?, notes?)
- `PATCH /api/admin/supplies/reorder` — save new sort order (orderedIds array)
- `PATCH /api/admin/supplies/:id` — update name/category/notes/isLowStock
- `DELETE /api/admin/supplies/:id` — delete supply
- Admin Supplies tab: drag-to-reorder rows (@dnd-kit), low-stock toggle switch, category badges, filter by category or low-stock-only, Order List dialog (copy/print all low-stock items)

### Migration SQL
`scripts/migrate-manual-booking.sql` — includes all schema changes (steps 1–10); run in Supabase SQL Editor before deploying. Step 10 adds `supplies` table.

## Gotchas

- After changing `lib/api-spec/openapi.yaml`, always run `pnpm --filter @workspace/api-spec run codegen` before typechecking frontend packages.
- Admin password is `vivid2024` (hardcoded, stored in `sessionStorage` key `adminAuth`).
- GHL webhooks fire to `GHL_WEBHOOK_URL`; pickup-time webhook fires to same URL with a distinct `event` field.
- `booking_drafts` table was added via `pnpm --filter @workspace/db run push`; also documented in migration SQL step 8 for Supabase production deployments.
