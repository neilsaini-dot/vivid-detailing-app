import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAdminListCalendarBookingConversions, getAdminListCalendarBookingConversionsQueryKey,
  useAdminSaveCalendarBookingConversion, useAdminConvertCalendarBooking, useAdminVerifyCalendarBookingWebhook,
  type CalendarConversionEvent, type CalendarBookingReview, type CalendarBookingConversionsList,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, RefreshCw, CheckCircle2, ExternalLink, CalendarDays } from "lucide-react";

const TZ = "America/Halifax";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function halifaxParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map(x => [x.type, x.value]));
  return p as Record<string, string>;
}
const currentMonth = () => { const p = halifaxParts(new Date()); return `${p.year}-${p.month}`; };
const shiftMonth = (m: string, delta: number) => {
  const [y, mo] = m.split("-").map(Number);
  const t = y * 12 + (mo - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const monthLabel = (m: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${m}-01T12:00:00Z`));

/** Convert an ISO-with-offset or local value to a Halifax datetime-local value (YYYY-MM-DDTHH:mm). */
function toLocalInput(v: string | null | undefined): string {
  if (!v || DATE_ONLY.test(v)) return "";
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(v)) {
    const d = new Date(v);
    if (isNaN(d.getTime())) return "";
    const p = halifaxParts(d);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : "";
}
const fromLocalInput = (v: string) => (v ? `${v}:00` : "");
const fmtEvent = (e: CalendarConversionEvent) => {
  if (e.allDay) {
    const ds = (e.start ?? "").slice(0, 10);
    if (DATE_ONLY.test(ds)) {
      const [y, m, d] = ds.split("-").map(Number);
      return `${new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", dateStyle: "medium" }).format(new Date(Date.UTC(y, m - 1, d, 12)))} · All day`;
    }
    return "All day";
  }
  if (!e.start) return "No start time";
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
  const d = new Date(e.start);
  return isNaN(d.getTime()) ? e.start : `${f.format(d)} (Halifax)`;
};
const fmtStamp = (iso: string | null) => iso ? new Intl.DateTimeFormat("en-CA", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) + " (Halifax)" : "—";

type Form = {
  serviceName: string; startTime: string; endTime: string; name: string; email: string; phone: string;
  type: string; year: string; make: string; model: string; colour: string; notes: string; total: string; confirmed: boolean;
};
const toForm = (e: CalendarConversionEvent): Form => {
  const r = e.review;
  const start = r ? toLocalInput(r.startTime) : "";
  const end = r ? toLocalInput(r.endTime) : "";
  return {
    serviceName: r ? r.serviceName : e.title === "Untitled calendar booking" ? "" : e.title,
    startTime: r ? start : e.allDay ? "" : toLocalInput(e.start),
    endTime: r ? end : e.allDay ? "" : toLocalInput(e.end),
    name: r?.customer.name ?? "", email: r?.customer.email ?? "", phone: r?.customer.phone ?? "",
    type: r?.vehicle.type ?? "", year: r?.vehicle.year ? String(r.vehicle.year) : "",
    make: r?.vehicle.make ?? "", model: r?.vehicle.model ?? "", colour: r?.vehicle.colour ?? "",
    notes: r ? r.notes : e.description ?? "",
    total: r?.totalEstimate == null ? "" : String(r.totalEstimate),
    confirmed: r?.confirmedCalendarOnly ?? false,
  };
};
const toBody = (f: Form): CalendarBookingReview => ({
  customer: { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() },
  vehicle: {
    type: (f.type || null) as CalendarBookingReview["vehicle"]["type"], year: f.year.trim() ? Number(f.year) : null,
    make: f.make.trim(), model: f.model.trim(), colour: f.colour.trim(),
  },
  notes: f.notes.trim(),
  totalEstimate: f.total.trim() ? Number(f.total) : null,
  serviceName: f.serviceName.trim(),
  startTime: fromLocalInput(f.startTime),
  endTime: fromLocalInput(f.endTime),
  confirmedCalendarOnly: f.confirmed,
});

function errInfo(e: unknown): { message: string; fields: string[] } {
  const err = e as { status?: number; data?: any; message?: string };
  const d = err?.data;
  const fields: string[] = [];
  const raw = d?.fields ?? d?.errors ?? d?.details;
  if (Array.isArray(raw)) raw.forEach((x: any) => fields.push(typeof x === "string" ? x : `${x.field ?? x.path ?? ""}: ${x.message ?? ""}`));
  else if (raw && typeof raw === "object") Object.entries(raw).forEach(([k, v]) => fields.push(`${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`));
  let message = d?.error ?? d?.message ?? err?.message ?? "Request failed";
  if (err?.status === 424) message = `Upstream verification unavailable. ${message}`;
  return { message, fields };
}

function Badges({ e }: { e: CalendarConversionEvent }) {
  const c = e.conversionState;
  const cls = c === "converted" ? "text-green-500 border-green-500/20 bg-green-500/10"
    : c === "failed" ? "text-red-500 border-red-500/20 bg-red-500/10"
    : c === "processing" ? "text-sky-400 border-sky-400/20 bg-sky-400/10"
    : "text-yellow-500 border-yellow-500/20 bg-yellow-500/10";
  const w = e.webhookState;
  const wl = w === "sent" ? "Webhook sent" : w === "pending" ? "Webhook not sent" : w === "sending" ? "Webhook sending" : "Webhook uncertain";
  const wc = w === "sent" ? "text-green-500 border-green-500/20" : w === "pending" ? "text-muted-foreground border-border" : "text-amber-500 border-amber-500/30";
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="outline" className={cls} data-testid={`status-calendar-conversion-${e.id}`}>{c}</Badge>
      <Badge variant="outline" className={wc} data-testid={`status-calendar-webhook-${e.id}`}>{wl}</Badge>
    </div>
  );
}

function EventRow({ e, label, onAction, candidate }: { e: CalendarConversionEvent; label: string; onAction: () => void; candidate?: boolean }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 grid gap-3 md:grid-cols-[1.4fr_1.3fr_auto_auto] md:items-center" data-testid={`row-calendar-booking-${e.id}`}>
      <div className="min-w-0">
        <p className="font-semibold text-sm truncate">{e.title || "Untitled event"}</p>
        <p className="text-xs text-muted-foreground truncate">{e.location || "No location"}</p>
        {candidate && <p className="text-[11px] text-amber-500 mt-0.5">May already exist in HighLevel or the app. Check before converting.</p>}
      </div>
      <div className="text-sm">
        <p>{fmtEvent(e)}</p>
        <p className="text-xs text-muted-foreground truncate">{e.review?.customer.name || "Customer not entered"}</p>
      </div>
      <Badges e={e} />
      <Button size="sm" variant="outline" className="border-border" onClick={onAction} data-testid={`button-review-calendar-${e.id}`}>{label}</Button>
    </div>
  );
}

function Group({ title, hint, items, empty, label, onAction, candidate }: {
  title: string; hint?: string; items: CalendarConversionEvent[]; empty: string; label: string;
  onAction: (e: CalendarConversionEvent) => void; candidate?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">{title} <span className="text-foreground">({items.length})</span></h4>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {items.length === 0
        ? <div className="border border-dashed border-border rounded-lg p-5 text-center text-sm text-muted-foreground">{empty}</div>
        : items.map(e => <EventRow key={e.id} e={e} label={label} candidate={candidate} onAction={() => onAction(e)} />)}
    </div>
  );
}

function CalendarSheet({ event, candidate, onClose, onSettled, onUpdated, onOpenBooking }: {
  event: CalendarConversionEvent | null; candidate: boolean; onClose: () => void; onSettled: () => void;
  onUpdated: (e: CalendarConversionEvent, kind: "save" | "convert" | "verify") => void; onOpenBooking: (id: string) => void;
}) {
  const save = useAdminSaveCalendarBookingConversion();
  const convert = useAdminConvertCalendarBooking();
  const verifyM = useAdminVerifyCalendarBookingWebhook();
  const [form, setForm] = useState<Form | null>(null);
  const [checked, setChecked] = useState(false);
  const [errors, setErrors] = useState<{ message: string; fields: string[] } | null>(null);
  const id = event?.id;
  const frozenKey = event ? `${event.webhookState}|${event.conversionState}|${event.bookingId ?? ""}|${event.reviewLocked}` : "";
  useEffect(() => { if (event) { setForm(toForm(event)); setErrors(null); setChecked(false); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, frozenKey]);
  if (!event || !form) return <Sheet open={false}><SheetContent /></Sheet>;

  const busy = save.isPending || convert.isPending || verifyM.isPending;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => f && { ...f, [k]: v });
  const converted = event.conversionState === "converted";
  const processing = event.conversionState === "processing";
  const webhookLocked = event.webhookState === "uncertain" || event.webhookState === "sending";
  const needsVerify = webhookLocked || processing;
  const frozen = event.reviewLocked || converted || processing;
  const retry = event.conversionState === "failed" && !converted;

  const digits = form.phone.replace(/\D/g, "");
  const phoneOk = digits.length >= 7 && digits.length <= 15;
  const phoneBad = digits.length > 15;
  const yearNum = form.year.trim() ? Number(form.year) : null;
  const yearBad = yearNum != null && (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > new Date().getFullYear() + 2);
  const emailBad = !!form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const typeOk = ["car", "suv", "truck", "van"].includes(form.type);
  const priceStr = form.total.trim();
  const price = priceStr ? Number(priceStr) : null;
  const priceBad = priceStr !== "" && (!/^\d+(?:\.\d{1,2})?$/.test(priceStr) || !Number.isFinite(price) || (price ?? 0) > 1000000);
  const timesOk = !!form.startTime && !!form.endTime && form.endTime > form.startTime;
  const timesBad = !!form.startTime && !!form.endTime && form.endTime <= form.startTime;
  const sourceOk = !candidate || form.confirmed;
  const baseValid = !yearBad && !emailBad && !priceBad && (typeOk || !form.type) && (!form.phone.trim() || phoneOk) && !phoneBad;
  const canSave = !busy && !frozen && baseValid && sourceOk && (!form.startTime || !form.endTime || timesOk);
  const canConvert = !busy && !converted && !webhookLocked && !processing && baseValid && typeOk && sourceOk && !!form.name.trim()
    && phoneOk && !!form.serviceName.trim() && price !== null && timesOk;

  const payload = (): CalendarBookingReview =>
    frozen && event.review
      ? { ...event.review, confirmedCalendarOnly: candidate ? form.confirmed : event.review.confirmedCalendarOnly }
      : toBody(form);
  const run = async (kind: "save" | "convert") => {
    setErrors(null);
    try {
      const m = kind === "save" ? save : convert;
      const res = await m.mutateAsync({ id: event.id, data: payload() });
      onUpdated(res, kind);
    } catch (e) { setErrors(errInfo(e)); }
    finally { onSettled(); }
  };
  const verify = async (delivered: boolean) => {
    setErrors(null);
    try {
      const res = await verifyM.mutateAsync({ id: event.id, data: { verifiedInGhl: true, delivered } });
      setChecked(false); onUpdated(res, "verify");
    } catch (e) { setErrors(errInfo(e)); }
    finally { onSettled(); }
  };

  const inp = "bg-surface-2 border-border h-9 text-sm";
  const lbl = "text-xs text-muted-foreground mb-1 block";
  const lastError = errors?.message ?? event.lastError;
  const lock = frozen;

  return (
    <Sheet open onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto bg-background border-border p-0">
        <SheetHeader className="px-6 py-5 border-b border-border sticky top-0 bg-background z-10">
          <SheetTitle>Review calendar-only booking</SheetTitle>
        </SheetHeader>
        <div className="px-6 py-6 space-y-5">
          <div className="bg-card border border-border rounded-lg p-4 grid grid-cols-2 gap-y-1.5 text-sm">
            <span className="text-muted-foreground">Google event</span><span className="break-words" data-testid="text-calendar-event-title">{event.title || "Untitled"}</span>
            <span className="text-muted-foreground">Scheduled</span><span data-testid="text-calendar-schedule">{fmtEvent(event)}</span>
            {event.location && <><span className="text-muted-foreground">Location</span><span className="break-words">{event.location}</span></>}
            <span className="text-muted-foreground">Event ID</span><span className="font-mono text-xs break-all select-all">{event.id}</span>
            {event.htmlUrl && <><span className="text-muted-foreground">Calendar</span>
              <a href={event.htmlUrl} target="_blank" rel="noreferrer" className="text-primary text-xs inline-flex items-center gap-1" data-testid="link-google-event"><ExternalLink className="h-3 w-3" />Open in Google Calendar</a></>}
            <p className="col-span-2 text-xs text-muted-foreground pt-2">The original Google event is linked and updated in place. No new Google event is created and no HighLevel appointment is deleted. Saving does not send a confirmation; converting does.</p>
          </div>

          {event.allDay && !converted && (
            <div className="border border-border bg-card rounded-lg p-3 text-sm text-muted-foreground" data-testid="alert-all-day">
              <Badge variant="outline" className="mr-2">All day</Badge>This event has no appointment time. Enter the actual start and end times below.
            </div>
          )}
          {candidate && !converted && (
            <div className="border border-amber-500/30 bg-amber-500/10 rounded-lg p-4 space-y-2" data-testid="panel-source-review">
              <p className="flex gap-2 text-sm text-amber-500 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />Overlaps a HighLevel or app booking</p>
              <label className="flex gap-2 text-sm items-start cursor-pointer">
                <input type="checkbox" className="mt-1" checked={form.confirmed} disabled={converted || processing} onChange={e => set("confirmed", e.target.checked)} data-testid="checkbox-confirmed-calendar-only" />
                <span>I checked HighLevel; this is a separate calendar-only booking.</span>
              </label>
              <p className="text-xs text-muted-foreground">Check both HighLevel and existing app bookings. The server still verifies this and will reject known matches.</p>
            </div>
          )}
          {webhookLocked && (
            <div className="flex gap-2 border border-amber-500/30 bg-amber-500/10 text-amber-500 rounded-lg p-3 text-sm" data-testid="alert-calendar-webhook-uncertain">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Booking-confirmed delivery is {event.webhookState}. Verify automation delivery in HighLevel before doing anything else; conversion retry is disabled to avoid a duplicate confirmation.</span>
            </div>
          )}
          {needsVerify && !converted && (
            <div className="border border-border bg-card rounded-lg p-4 space-y-3" data-testid="panel-verify-calendar-webhook">
              <p className="text-sm font-semibold">Verify booking-confirmed automation</p>
              <label className="flex gap-2 text-sm items-start cursor-pointer">
                <input type="checkbox" className="mt-1" checked={checked} onChange={e => setChecked(e.target.checked)} data-testid="checkbox-calendar-verified-ghl" />
                <span>I checked the booking-confirmed automation history in HighLevel for this customer.</span>
              </label>
              <p className="text-xs text-amber-500">Do not mark "not delivered" without checking. A wrong answer may send a duplicate confirmation. In-progress requests have a 2-minute safety wait before verification.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!checked || busy} onClick={() => verify(true)} data-testid="button-calendar-mark-delivered">{verifyM.isPending ? "Saving…" : "Mark delivered"}</Button>
                <Button size="sm" variant="outline" className="border-border" disabled={!checked || busy} onClick={() => verify(false)} data-testid="button-calendar-mark-not-delivered">Mark not delivered</Button>
              </div>
            </div>
          )}
          {retry && (
            <div className="border border-border bg-card rounded-lg p-3 text-sm text-muted-foreground" data-testid="alert-calendar-booking-retry">
              Resume uses the saved review and repeats only unfinished steps. A linked calendar event and an acknowledged webhook are not repeated.
            </div>
          )}
          {lastError && (
            <div className="flex gap-2 border border-red-500/30 bg-red-500/10 text-red-400 rounded-lg p-3 text-sm" data-testid="text-calendar-last-error">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div><p>{lastError}</p>{errors?.fields.map((f, i) => <p key={i} className="text-xs mt-1">{f}</p>)}</div>
            </div>
          )}
          {lock && !converted && <p className="text-xs text-muted-foreground" data-testid="text-calendar-frozen">Fields are locked because conversion has progressed. Resume uses the saved review.</p>}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className={lbl}>Service *</label><Input className={inp} value={form.serviceName} maxLength={300} onChange={e => set("serviceName", e.target.value)} disabled={lock} data-testid="input-cal-service" /></div>
            <div><label className={lbl}>Start (Halifax) *</label><Input className={inp} type="datetime-local" value={form.startTime} onChange={e => set("startTime", e.target.value)} disabled={lock} data-testid="input-cal-start" /></div>
            <div><label className={lbl}>End (Halifax) *</label><Input className={inp} type="datetime-local" value={form.endTime} onChange={e => set("endTime", e.target.value)} disabled={lock} data-testid="input-cal-end" /></div>
            {(timesBad || (!timesOk && !lock)) && <p className={`col-span-2 text-[11px] -mt-1 ${timesBad ? "text-red-400" : "text-amber-500"}`}>{timesBad ? "End must be after start." : "Valid start and end times are required to convert."}</p>}
            <div className="col-span-2"><label className={lbl}>Customer name *</label><Input className={inp} value={form.name} onChange={e => set("name", e.target.value)} disabled={lock} data-testid="input-cal-name" /></div>
            <div><label className={lbl}>Phone *</label><Input className={inp} value={form.phone} onChange={e => set("phone", e.target.value)} disabled={lock} data-testid="input-cal-phone" />
              {phoneBad && <p className="text-[11px] text-red-400 mt-1">Phone can have at most 15 digits</p>}
              {!phoneOk && !phoneBad && <p className="text-[11px] text-amber-500 mt-1">Usable phone needed to convert</p>}</div>
            <div><label className={lbl}>Email</label><Input className={inp} value={form.email} onChange={e => set("email", e.target.value)} disabled={lock} data-testid="input-cal-email" />
              {emailBad && <p className="text-[11px] text-red-400 mt-1">Enter a valid email</p>}</div>
            <div><label className={lbl}>Vehicle type *</label>
              <Select value={form.type} onValueChange={v => set("type", v)} disabled={lock}>
                <SelectTrigger className={inp} data-testid="select-cal-type"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>{["car", "suv", "truck", "van"].map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><label className={lbl}>Price including HST *</label>
              <Input className={inp} type="number" min="0" max="1000000" step="0.01" value={form.total} onChange={e => set("total", e.target.value)} disabled={lock} data-testid="input-cal-total" />
              <p className={`text-[11px] mt-1 ${priceBad || price === null ? "text-amber-500" : "text-muted-foreground"}`}>{priceBad ? "Valid amount, up to two decimals." : price === null ? "Required. Enter 0 explicitly for no charge." : "Total including HST."}</p></div>
            <div><label className={lbl}>Year</label><Input className={inp} inputMode="numeric" value={form.year} onChange={e => set("year", e.target.value)} disabled={lock} data-testid="input-cal-year" />
              {yearBad && <p className="text-[11px] text-red-400 mt-1">Enter a valid year</p>}</div>
            <div><label className={lbl}>Make</label><Input className={inp} value={form.make} onChange={e => set("make", e.target.value)} disabled={lock} data-testid="input-cal-make" /></div>
            <div><label className={lbl}>Model</label><Input className={inp} value={form.model} onChange={e => set("model", e.target.value)} disabled={lock} data-testid="input-cal-model" /></div>
            <div><label className={lbl}>Colour</label><Input className={inp} value={form.colour} onChange={e => set("colour", e.target.value)} disabled={lock} data-testid="input-cal-colour" /></div>
            <div className="col-span-2"><label className={lbl}>Notes</label><Textarea className="bg-surface-2 border-border text-sm" rows={4} maxLength={4000} value={form.notes} onChange={e => set("notes", e.target.value)} disabled={lock} data-testid="input-cal-notes" /></div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" className="border-border" disabled={!canSave} onClick={() => run("save")} data-testid="button-save-calendar">
              {save.isPending ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : "Save details"}
            </Button>
            <Button disabled={!canConvert} onClick={() => run("convert")} data-testid="button-convert-calendar">
              {convert.isPending ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Converting…</> : retry ? "Resume conversion" : "Convert to booking"}
            </Button>
            {event.bookingId && <Button variant="ghost" onClick={() => onOpenBooking(event.bookingId!)} data-testid="button-open-calendar-booking-sheet">Open booking</Button>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function CalendarBookingsSection({ onOpenBooking }: { onOpenBooking: (bookingId: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [month, setMonth] = useState(currentMonth);
  const params = { month };
  const queryKey = getAdminListCalendarBookingConversionsQueryKey(params);
  const { data, isLoading, error, refetch, isFetching } = useAdminListCalendarBookingConversions(params, {
    query: { queryKey, refetchInterval: 30_000, refetchOnWindowFocus: true, refetchOnMount: "always", retry: false },
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const events = useMemo(() => data?.events ?? [], [data]);
  const candidates = useMemo(() => data?.needsSourceReview ?? [], [data]);
  const converted = useMemo(() => data?.converted ?? [], [data]);
  const selected = [...events, ...candidates, ...converted].find(e => e.id === selectedId) ?? null;
  const isCandidate = !!selected && candidates.some(e => e.id === selected.id);

  const patch = (u: CalendarConversionEvent) => {
    qc.setQueryData<CalendarBookingConversionsList>(queryKey, old => {
      if (!old) return old;
      const swap = (l: CalendarConversionEvent[]) => l.map(x => (x.id === u.id ? u : x));
      if (u.conversionState === "converted") {
        return { ...old, events: old.events.filter(x => x.id !== u.id), needsSourceReview: old.needsSourceReview.filter(x => x.id !== u.id),
          converted: old.converted.some(x => x.id === u.id) ? swap(old.converted) : [u, ...old.converted] };
      }
      return { ...old, events: swap(old.events), needsSourceReview: swap(old.needsSourceReview), converted: swap(old.converted) };
    });
  };
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/admin/calendar-booking-conversions"] });
    qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && /calendar|admin\/bookings|bookings|customers|vehicles/.test(q.queryKey[0] as string) });
  };

  const errStatus = (error as { status?: number } | null)?.status;
  const nowMonth = currentMonth();

  return (
    <section className="space-y-5 border-t border-border pt-8" data-testid="section-calendar-bookings">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <CalendarDays className="h-4 w-4 text-primary mt-0.5" />
          <div>
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Calendar-only bookings</h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">Events that exist only in Google Calendar. Review them, enter missing details, and convert them to app bookings. The original event is updated in place.</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="border-border" onClick={() => setMonth(m => shiftMonth(m, -1))} data-testid="button-calendar-prev-month">Prev</Button>
          <Input type="month" className="bg-surface-2 border-border h-8 w-40 text-sm" value={month} onChange={e => /^\d{4}-\d{2}$/.test(e.target.value) && setMonth(e.target.value)} data-testid="input-calendar-month" />
          <Button size="sm" variant="outline" className="border-border" onClick={() => setMonth(m => shiftMonth(m, 1))} data-testid="button-calendar-next-month">Next</Button>
          {month !== nowMonth && <Button size="sm" variant="ghost" onClick={() => setMonth(nowMonth)} data-testid="button-calendar-this-month">This month</Button>}
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-calendar-bookings"><RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /></Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="text-calendar-month">{monthLabel(month)} (Halifax)</p>

      {isLoading ? (
        <div className="space-y-3" data-testid="state-calendar-loading">{[0, 1, 2].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : error ? (
        <div className="border border-border bg-card rounded-lg p-8 text-center space-y-3" data-testid="state-calendar-error">
          <AlertTriangle className="h-6 w-6 mx-auto text-amber-500" />
          <p className="font-semibold">{errStatus === 424 ? "Calendar verification unavailable" : errStatus === 409 ? "Calendar bookings are locked" : "Couldn't load calendar bookings"}</p>
          <p className="text-sm text-muted-foreground">{errInfo(error).message}</p>
          <Button variant="outline" onClick={() => refetch()} data-testid="button-retry-calendar-bookings">Retry</Button>
        </div>
      ) : (
        <div className="space-y-6">
          <Group title="Calendar-only queue" hint="Google events with no HighLevel match." items={events} empty="No calendar-only events to convert this month." label="Review" onAction={e => setSelectedId(e.id)} />
          <Group title="Needs source review" hint="These overlap a HighLevel appointment or an app booking and have no clear source marker. Check both before converting." items={candidates} empty="No events need source review." label="Review" candidate onAction={e => setSelectedId(e.id)} />
          <Group title="Converted calendar bookings" items={converted} empty="Nothing converted this month." label="Details" onAction={e => setSelectedId(e.id)} />
          {converted.length > 0 && (
            <div className="grid gap-2 md:grid-cols-2">
              {converted.map(e => (
                <div key={e.id} className="text-xs text-muted-foreground bg-card border border-border rounded-lg p-3 space-y-1" data-testid={`receipt-calendar-${e.id}`}>
                  <p className="text-foreground font-medium flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-green-500" />{e.review?.customer.name || "Customer"} · {fmtStamp(e.convertedAt)}</p>
                  <p>Service: {e.review?.serviceName || e.title}</p>
                  <p>Delivery: {e.webhookState}</p>
                  {e.bookingId && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onOpenBooking(e.bookingId!)} data-testid={`button-open-calendar-booking-${e.id}`}><ExternalLink className="h-3 w-3 mr-1" />Open booking</Button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <CalendarSheet
        event={selected}
        candidate={isCandidate}
        onClose={() => setSelectedId(null)}
        onSettled={invalidate}
        onOpenBooking={id => { setSelectedId(null); onOpenBooking(id); }}
        onUpdated={(u, kind) => {
          patch(u);
          if (kind === "save") toast({ title: "Details saved" });
          else if (kind === "verify") toast({ title: u.webhookState === "sent" ? "Marked delivered" : "Marked not delivered" });
          else if (u.conversionState === "converted") { setSelectedId(null); toast({ title: "Converted to booking", description: "Original Google event updated and confirmation sent." }); }
          else toast({ variant: "destructive", title: "Conversion incomplete", description: u.lastError ?? "Review the error and resume." });
        }}
      />
    </section>
  );
}
