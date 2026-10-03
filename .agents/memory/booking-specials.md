---
name: Frequently booked specials
description: Owner-provided ceramic and detailing offer terms and intended Facebook-to-GoHighLevel booking flow.
---

The owner frequently books two specials and wants people sent to a link, not through the conversation bot's booking tool. Leads usually arrive from Facebook into GoHighLevel chat. The owner clarified that special links belong under the existing book.vividpei.com app, and customers should complete booking on those app pages—not be redirected to GoHighLevel calendars. App bookings should also be created automatically when the owner manually sets an appointment for either special in GoHighLevel, following the other booking flows.

**Why:** The owner explicitly requested this channel-specific booking flow.

**How to apply:** Add native special booking routes to the existing app, preserve ordinary booking flows, and support matching manually created GoHighLevel appointments separately when needed. Do not claim limited remaining spots without current availability evidence.

## Owner-provided ceramic special

- $995 Ceramic Coating Special, saving over $1,000 off the regular package price.
- Full hand wash; chemical + mechanical paint decontamination; one-stage paint enhancement.
- Full prep of paint, exterior plastics, and windshield.
- Premium ceramic coating on paint, trim, and windshield.
- Professional installation by an accredited ceramic coating installer.
- Coating rated for up to 5 years; includes 3 years of maintenance applications.
- Typically requires the vehicle for 24–36 hours; availability is limited.
- Owner's suggested chat question: “How soon are you looking to get your vehicle protected: within the next week or two, or a little later?”

## Owner-provided detailing special

- $199 Full Interior & Exterior Detail, saving over $100.
- Ongoing for this booking flow; the owner explicitly said to ignore the October 31 deadline.
- Full interior deep clean.
- Steam clean of seats, cup holders, vents, buttons, door panels, and tight spaces.
- UV sun protectant on plastic trim with a subtle shine.
- Exterior snow foam and hand wash.
- Exterior wax for shine and protection against salt and road chemicals.
- SUVs cost an additional $20; trucks an additional $40.
- Van price is $269.
- Leather conditioning or cloth stain extraction may be added for an extra charge.
- Spots are limited each week.

## Tax and appointment schedules

The owner confirmed that 15% HST is added to the advertised prices.

Both GoHighLevel calendars are active with separate dedicated schedules: “Ceramic Coating” has 24-hour slots; “Book a detailing” has 6-hour slots. The ceramic appointment slot is not the same as the advertised 24–36-hour vehicle turnaround.

**Why:** These are explicit owner-provided pricing and scheduling requirements.

**How to apply:** Use $199/$219/$239/$269 before HST for car/SUV/truck/van detailing, omit the detailing expiry for this flow, and use the dedicated calendar for each special.

The owner confirmed the ceramic special is $995 before HST for all vehicle types.

## Hosting and integration approach

The existing app is hosted at book.vividpei.com. The owner wants changes pushed to the existing GitHub repository and uses Supabase, with Railway as the app hosting target. The owner clarified that the primary goal is native special pages in this existing app, not a separate GoHighLevel receiver project.

**Why:** The owner corrected the earlier integration-heavy interpretation and explicitly selected completing special bookings on new pages in the existing app.

**How to apply:** Reuse the existing app, repository, and Supabase database. Do not require GoHighLevel connector setup or a webhook migration for native special-page bookings. The optional webhook importer is a separate manual-appointment compatibility path, not the prerequisite for launching special links.

Keep GoHighLevel authoritative for imported special appointment times and cancellations unless the owner explicitly requests bidirectional scheduling.

**Why:** The accepted integration uses native GoHighLevel workflow notifications, not a direct appointment-management API connection. Whether GoHighLevel already synchronizes the owner's Google Calendar has not been confirmed; two scheduling writers can produce duplicate or conflicting events.

**How to apply:** Verify calendar ownership and obtain an explicit bidirectional-sync requirement before enabling app-side appointment/calendar mutations for imported specials. This restriction does not prevent inspection, pickup, completion, or review workflows.