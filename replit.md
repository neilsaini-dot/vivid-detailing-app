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

### Migration SQL
`scripts/migrate-manual-booking.sql` — includes all schema changes; run in Supabase SQL Editor before deploying.

## Gotchas

- After changing `lib/api-spec/openapi.yaml`, always run `pnpm --filter @workspace/api-spec run codegen` before typechecking frontend packages.
- Admin password is `vivid2024` (hardcoded, stored in `sessionStorage` key `adminAuth`).
- GHL webhooks fire to `GHL_WEBHOOK_URL`; pickup-time webhook fires to same URL with a distinct `event` field.
