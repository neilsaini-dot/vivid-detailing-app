import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Check, Loader2, AlertTriangle, CalendarDays, Clock } from "lucide-react";
import {
  useCreateBooking,
  useGetCalendarAvailability,
  useGetCalendarNextSlots,
  getGetCalendarAvailabilityQueryKey,
  getGetCalendarNextSlotsQueryKey,
} from "@workspace/api-client-react";
import type { Booking } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatHalifax, formatWallDate, halifaxToday, halifaxWallToIso, slotWallDate, slotWallTime, HALIFAX_TZ,
} from "@/lib/halifax-time";

type Offer = "ceramic_special" | "detailing_special";
type VType = "car" | "suv" | "truck" | "van";

const money = (n: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

const VEHICLES: { id: VType; label: string; img: string }[] = [
  { id: "car", label: "Car", img: "vehicle-sedan.png" },
  { id: "suv", label: "SUV", img: "vehicle-suv.png" },
  { id: "truck", label: "Truck", img: "vehicle-truck.png" },
  { id: "van", label: "Van", img: "vehicle-van.png" },
];

const OFFERS = {
  ceramic_special: {
    path: "/ceramic-special",
    name: "Ceramic Coating Special",
    title: "Ceramic Coating Special | Vivid Detailing PEI",
    desc: "Book the Vivid Detailing ceramic coating special in PEI: full prep, one-stage enhancement and an accredited-installer coating for $995 plus HST.",
    tagline: "Full prep, one-stage enhancement and an accredited-installer coating, one price for every vehicle type.",
    slotHours: 24,
    base: { car: 995, suv: 995, truck: 995, van: 995 } as Record<VType, number>,
    total: { car: 1144.25, suv: 1144.25, truck: 1144.25, van: 1144.25 } as Record<VType, number>,
    saves: "Saves over $1,000 off the regular package price.",
    includes: [
      "Full hand wash",
      "Chemical and mechanical decontamination",
      "One-stage paint enhancement",
      "Paint, exterior plastics and windshield prep",
      "Coating applied to paint, trim and windshield by an accredited installer",
      "Coating rated for up to 5 years, including 3 years of maintenance applications",
    ],
    timing: "Your vehicle is booked in for 24 hours on the calendar. Actual turnaround is typically 24 to 36 hours.",
    other: "detailing_special" as Offer,
    notesHint: "Anything we should know about the paint, swirl marks, chips or past coatings?",
  },
  detailing_special: {
    path: "/detailing-special",
    name: "Full Detailing Special",
    title: "Full Interior and Exterior Detailing Special | Vivid Detailing PEI",
    desc: "Book the Vivid Detailing full detailing special in PEI: interior deep clean, steam clean, UV protection, snow foam wash and wax from $199 plus HST.",
    tagline: "A full interior deep clean with a snow foam hand wash and wax outside. Priced by vehicle type.",
    slotHours: 6,
    base: { car: 199, suv: 219, truck: 239, van: 269 } as Record<VType, number>,
    total: { car: 228.85, suv: 251.85, truck: 274.85, van: 309.35 } as Record<VType, number>,
    saves: "Saves over $100 off the regular package price.",
    includes: [
      "Full interior deep clean",
      "Steam clean of seats, cupholders, vents, buttons, door panels and tight spaces",
      "UV protection for plastic trim",
      "Exterior snow foam and hand wash",
      "Wax",
    ],
    timing: "Your vehicle is booked in for a 6 hour slot. This offer has no expiry date.",
    other: "ceramic_special" as Offer,
    notesHint: "Leather conditioning and stain extraction are not part of this price. Tell us here if you want either and we will follow up with you.",
  },
};

function setMeta(sel: string, attr: string, key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(sel);
  if (!el) { el = document.createElement("meta"); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute("content", value);
}

function errorMessage(e: unknown): string {
  const any = e as { data?: { error?: string; message?: string }; message?: string; status?: number };
  const server = any?.data?.error || any?.data?.message;
  if (server) return `${server} Please check your details or choose another time, then try again.`;
  if (any?.status && any.status >= 500) return "Our booking system had a problem and nothing was saved. Please try again in a moment, or call the shop.";
  return "We could not submit your booking, so nothing was saved. Check your connection and try again.";
}

function Field({ id, label, children, error }: { id: string; label: string; children: React.ReactNode; error?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-sm text-destructive" role="alert" data-testid={`error-${id}`}>{error}</p>}
    </div>
  );
}

export default function SpecialBooking({ offer }: { offer: Offer }) {
  const o = OFFERS[offer];
  const other = OFFERS[o.other];

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [vtype, setVtype] = useState<VType | "">("");
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [colour, setColour] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [tried, setTried] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [summary, setSummary] = useState<{ when: string; vehicle: string; total: number } | null>(null);

  const createBooking = useCreateBooking();
  const today = useMemo(() => halifaxToday(), []);

  useEffect(() => {
    document.title = o.title;
    setMeta('meta[name="description"]', "name", "description", o.desc);
    setMeta('meta[property="og:title"]', "property", "og:title", o.title);
    setMeta('meta[property="og:description"]', "property", "og:description", o.desc);
    setMeta('meta[property="og:type"]', "property", "og:type", "website");
    setMeta('meta[property="og:image"]', "property", "og:image", `${window.location.origin}${import.meta.env.BASE_URL}opengraph.jpg`);
    setMeta('meta[property="og:url"]', "property", "og:url", `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}${o.path}`);
    window.scrollTo(0, 0);
    setDate(""); setTime(""); setSubmitError("");
    setBooking(null); setSummary(null); setVtype(""); setTried(false);
  }, [offer, o]);

  const nextParams = { duration: o.slotHours, count: 3, strict: true };
  const nextSlots = useGetCalendarNextSlots(nextParams, { query: { queryKey: getGetCalendarNextSlotsQueryKey(nextParams) } as any });
  const availParams = { date, duration: o.slotHours, strict: true };
  const avail = useGetCalendarAvailability(availParams, { query: { enabled: !!date, queryKey: getGetCalendarAvailabilityQueryKey(availParams) } as any });

  const base = vtype ? o.base[vtype] : null;
  const total = vtype ? o.total[vtype] : null;
  const hst = base !== null && total !== null ? r2(total - base) : null;

  const errs: Record<string, string> = {};
  if (name.trim().length < 2) errs.name = "Enter your full name.";
  if (phone.replace(/\D/g, "").length < 10) errs.phone = "Enter a phone number with area code.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = "Enter a valid email address.";
  if (!vtype) errs.vtype = "Choose a vehicle type to see your price and book.";
  const yr = Number(year);
  if (!/^\d{4}$/.test(year) || yr < 1950 || yr > new Date().getFullYear() + 1) errs.year = "Enter a 4 digit year.";
  if (!make.trim()) errs.make = "Enter the make.";
  if (!model.trim()) errs.model = "Enter the model.";
  if (!colour.trim()) errs.colour = "Enter the colour.";
  if (!date || !time) errs.slot = "Choose a date and a time from the calendar.";
  const show = (k: string) => (tried ? errs[k] : undefined);

  const pickSlot = (d: string, t: string) => { setDate(d); setTime(t); };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    setSubmitError("");
    if (Object.keys(errs).length > 0 || !vtype || total === null) {
      const first = document.querySelector<HTMLElement>("[data-invalid='true'], [role='alert']");
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    createBooking.mutate(
      {
        data: {
          specialOffer: offer,
          customer: { name: name.trim(), phone: phone.trim(), email: email.trim() },
          vehicle: { type: vtype, year: yr, make: make.trim(), model: model.trim(), colour: colour.trim() },
          serviceIds: [],
          addOnIds: [],
          promoIds: [],
          appointmentAt: halifaxWallToIso(date, time),
          notes: notes.trim() || undefined,
        },
      },
      {
        onSuccess: (b) => {
          setSummary({ when: `${formatWallDate(date)}, ${time} (Halifax time)`, vehicle: `${year} ${make.trim()} ${model.trim()}, ${colour.trim()}`, total });
          setBooking(b);
          window.scrollTo({ top: 0, behavior: "smooth" });
        },
        onError: (err) => setSubmitError(errorMessage(err)),
      },
    );
  };

  const slotList = (avail.data as any)?.slots as { start: string; end: string; label: string; available: boolean }[] | undefined;
  const nextList = (nextSlots.data as any)?.slots as { date: string; start: string; end: string; label: string; dateLabel?: string }[] | undefined;

  if (booking && summary) {
    const returnedTotal = typeof booking.totalEstimate === "number" ? booking.totalEstimate : summary.total;
    return (
      <div className="container max-w-2xl py-10 md:py-16" data-testid="booking-confirmation">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary"><Check /></div>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Booking request received</h1>
        <p className="mt-3 text-muted-foreground">
          We have received your request for the {o.name}. Its current status is{" "}
          <strong className="text-foreground" data-testid="text-booking-status">{booking.status}</strong>. The shop will review it and contact you
          at {email.trim()} or {phone.trim()} if anything about your time needs to change. Keep your booking ID for reference.
        </p>
        <dl className="mt-8 divide-y divide-border rounded-lg border border-border bg-card text-sm">
          {[
            ["Booking ID", booking.id, "text-booking-id"],
            ["Status", booking.status, "text-status"],
            ["Offer", o.name, "text-offer"],
            ["Requested time", booking.appointmentAt ? formatHalifax(booking.appointmentAt) : summary.when, "text-when"],
            ["Vehicle", summary.vehicle, "text-vehicle"],
            ["Name", name.trim(), "text-name"],
            ["Total including HST", money(returnedTotal), "text-total"],
          ].map(([k, v, t]) => (
            <div key={k} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:justify-between">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-all font-medium sm:text-right" data-testid={t}>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={other.path}><Button variant="outline" data-testid="link-other-special">View the {other.name}</Button></Link>
          <Link href="/book"><Button variant="ghost" data-testid="link-normal-booking">Browse all services</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <section className="border-b border-border bg-card/40">
        <div className="container grid gap-8 py-10 md:grid-cols-[1.1fr_0.9fr] md:py-16">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">Vivid Detailing, Prince Edward Island</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl" data-testid="heading-offer">{o.name}</h1>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground">{o.tagline}</p>
            <p className="mt-6 text-3xl font-bold" data-testid="text-headline-price">
              {offer === "ceramic_special" ? "$995" : "From $199"}
              <span className="ml-2 text-base font-normal text-muted-foreground">plus 15% HST</span>
            </p>
            <p className="mt-2 text-sm text-primary">{o.saves}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-3 font-semibold">What is included</h2>
            <ul className="space-y-2.5 text-sm">
              {o.includes.map((i) => (
                <li key={i} className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{i}</span></li>
              ))}
            </ul>
            <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">{o.timing}</p>
          </div>
        </div>
      </section>

      <form onSubmit={onSubmit} noValidate className="container max-w-3xl space-y-10 py-10" data-testid="form-special-booking">
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">1. Your contact details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field id="name" label="Full name" error={show("name")}>
              <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-name" />
            </Field></div>
            <Field id="phone" label="Phone" error={show("phone")}>
              <Input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-phone" />
            </Field>
            <Field id="email" label="Email" error={show("email")}>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">2. Your vehicle</h2>
          <div role="radiogroup" aria-label="Vehicle type" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {VEHICLES.map((v) => {
              const on = vtype === v.id;
              return (
                <button
                  type="button" role="radio" aria-checked={on} key={v.id} onClick={() => setVtype(v.id)}
                  data-testid={`button-vehicle-${v.id}`}
                  className={`rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"}`}
                >
                  <img src={`${import.meta.env.BASE_URL}${v.img}`} alt="" className="h-16 w-full object-contain" />
                  <div className="mt-2 font-medium">{v.label}</div>
                  <div className="text-sm text-muted-foreground">{money(o.base[v.id])}</div>
                </button>
              );
            })}
          </div>
          {show("vtype") && <p className="text-sm text-destructive" role="alert" data-testid="error-vtype">{errs.vtype}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="year" label="Year" error={show("year")}><Input id="year" inputMode="numeric" maxLength={4} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} data-testid="input-year" /></Field>
            <Field id="make" label="Make" error={show("make")}><Input id="make" value={make} onChange={(e) => setMake(e.target.value)} data-testid="input-make" /></Field>
            <Field id="model" label="Model" error={show("model")}><Input id="model" value={model} onChange={(e) => setModel(e.target.value)} data-testid="input-model" /></Field>
            <Field id="colour" label="Colour" error={show("colour")}><Input id="colour" value={colour} onChange={(e) => setColour(e.target.value)} data-testid="input-colour" /></Field>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">3. Pick a time</h2>
          <p className="text-sm text-muted-foreground">All times are Halifax time (Atlantic), no matter where your device is set. {o.timing}</p>

          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><Clock className="h-4 w-4 text-primary" />Next openings</h3>
            {nextSlots.isLoading ? (
              <div className="grid gap-2 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : nextSlots.isError ? (
              <p className="text-sm text-destructive" role="alert">Could not load openings. <button type="button" className="underline" onClick={() => nextSlots.refetch()}>Try again</button> or choose a date below.</p>
            ) : nextList && nextList.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-3">
                {nextList.map((s, i) => {
                  const d = slotWallDate(s.date, s.start); const t = slotWallTime(s.start);
                  const on = date === d && time === t;
                  return (
                    <button type="button" key={`${s.date}-${s.start}-${i}`} onClick={() => pickSlot(d, t)} aria-pressed={on} data-testid={`button-next-slot-${i}`}
                      className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${on ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"}`}>
                      <div className="font-medium">{s.dateLabel ?? formatWallDate(d)}</div>
                      <div className="text-muted-foreground">{s.label}</div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No upcoming openings are listed right now. Try a specific date below.</p>
            )}
          </div>

          <div className="max-w-xs">
            <Field id="date" label="Or choose a date">
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input id="date" type="date" min={today} value={date} onChange={(e) => { setDate(e.target.value); setTime(""); }} data-testid="input-date" />
              </div>
            </Field>
          </div>

          {date && (
            <div aria-live="polite">
              <h3 className="mb-2 text-sm font-medium">Availability for {formatWallDate(date)}</h3>
              {avail.isFetching ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : avail.isError ? (
                <p className="text-sm text-destructive" role="alert">Could not load this date. <button type="button" className="underline" onClick={() => avail.refetch()}>Retry</button></p>
              ) : slotList && slotList.some((s) => s.available) ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {slotList.map((s) => {
                    const t = slotWallTime(s.start); const on = time === t;
                    return (
                      <button type="button" key={s.start} disabled={!s.available} onClick={() => setTime(t)} aria-pressed={on} data-testid={`button-slot-${t}`}
                        className={`rounded-md border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:line-through ${on ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"}`}>
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-no-slots">Nothing is available on this date. Please pick another day.</p>
              )}
            </div>
          )}
          {date && time && (
            <p className="rounded-md bg-primary/10 px-3 py-2 text-sm" data-testid="text-selected-slot">
              Selected: {formatWallDate(date)} at {time} Halifax time. This is a request until the shop confirms it.
            </p>
          )}
          {show("slot") && <p className="text-sm text-destructive" role="alert" data-testid="error-slot">{errs.slot}</p>}
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Vehicle condition notes (optional)</h2>
          <Label htmlFor="notes" className="text-sm font-normal text-muted-foreground">{o.notesHint}</Label>
          <Textarea id="notes" rows={4} maxLength={1500} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-notes" />
        </section>

        <section className="rounded-lg border border-border bg-card p-5" aria-live="polite">
          <h2 className="mb-3 text-xl font-semibold">Price</h2>
          {base === null || total === null || hst === null ? (
            <p className="text-sm text-muted-foreground" data-testid="text-price-pending">Choose a vehicle type above to see your itemized price.</p>
          ) : (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt>{o.name}</dt><dd data-testid="text-base">{money(base)}</dd></div>
              <div className="flex justify-between"><dt>HST (15%)</dt><dd data-testid="text-hst">{money(hst)}</dd></div>
              <div className="flex justify-between border-t border-border pt-2 text-lg font-bold"><dt>Total</dt><dd data-testid="text-total-price">{money(total)}</dd></div>
            </dl>
          )}
          <p className="mt-3 text-xs text-muted-foreground">The final price is calculated by the shop's booking system when you submit. Payment is not taken on this page.</p>
        </section>

        {submitError && (
          <div className="flex gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm" role="alert" data-testid="error-submit">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p>{submitError}</p>
              <button type="button" className="mt-2 font-medium underline" onClick={() => onSubmit({ preventDefault() {} } as React.FormEvent)} data-testid="button-retry">Try again</button>
            </div>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" disabled={createBooking.isPending} data-testid="button-submit-booking">
          {createBooking.isPending ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting your booking</>) : "Submit booking request"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">Times use {HALIFAX_TZ.replace("_", " ")}. Your request is saved as submitted and the shop confirms it.</p>

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-border pt-6 text-sm">
          <Link href={other.path} className="text-primary hover:underline" data-testid="link-other-special-form">See the {other.name}</Link>
          <Link href="/book" className="text-primary hover:underline" data-testid="link-normal-booking-form">Book any other service</Link>
        </div>
      </form>
    </div>
  );
}
