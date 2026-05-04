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
- `POST /api/admin/bookings` — create a booking from the admin panel (customer search/create, vehicle select/create, free-form line items, source, status, total override)
- `GET /api/admin/customers/search?q=` — live customer search by name/email/phone with their vehicles
- Source filter on `GET /api/admin/bookings?source=phone|walkin|online|referral|other`
- Bookings table shows colour-coded source badges (blue=Online, purple=Phone, orange=Walk-in, green=Referral)
- "New Booking" button opens a slide-over sheet with: customer search/create, vehicle select/create, quick-service shortcuts, line item builder with auto-total, manual total override, source & status dropdowns, appointment datetime, notes
- If status is `confirmed`, fires GHL webhook + Google Calendar event automatically
- New DB columns: `bookings.source` (default 'online'), `bookings.is_manual_price_override`, `bookings.created_by_admin`; `booking_items.item_type` now also allows `'manual'`

### Migration SQL
`scripts/migrate-manual-booking.sql` — run in Supabase SQL Editor and Railway before deploying.
