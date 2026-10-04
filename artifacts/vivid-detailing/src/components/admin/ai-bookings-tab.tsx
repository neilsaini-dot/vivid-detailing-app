import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAdminListAiBookings, getAdminListAiBookingsQueryKey, getAdminListBookingsQueryKey,
  useAdminSaveAiBooking, useAdminConvertAiBooking, useAdminResolveAiBookingWebhook,
  type AiBooking, type AiBookingReviewBody,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, RefreshCw, CheckCircle2, Sparkles, ExternalLink } from "lucide-react";

const TZ = "America/Halifax";
const fmtHalifax = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-CA", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) + " (Halifax)" : "—";
const specialLabel = (s: string) => (s === "ceramic_special" ? "Ceramic Special" : "Detailing Special");
const money = (n: number | null) => (n == null ? "Pending" : `$${n.toFixed(2)}`);
const isActive = (b: AiBooking) => b.status === "pending" || b.status === "confirmed";

function StateBadges({ b }: { b: AiBooking }) {
  const conv = b.conversionState;
  const cls = conv === "converted" ? "text-green-500 border-green-500/20 bg-green-500/10"
    : conv === "failed" ? "text-red-500 border-red-500/20 bg-red-500/10"
    : conv === "processing" ? "text-sky-400 border-sky-400/20 bg-sky-400/10"
    : "text-yellow-500 border-yellow-500/20 bg-yellow-500/10";
  const wh = b.webhookState === "sent" ? "Webhook sent" : b.webhookState === "pending" ? "Webhook not sent" : b.webhookState === "sending" ? "Webhook sending" : "Webhook uncertain";
  const whCls = b.webhookState === "sent" ? "text-green-500 border-green-500/20" : b.webhookState === "pending" ? "text-muted-foreground border-border" : "text-amber-500 border-amber-500/30";
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="outline" className={cls} data-testid={`status-conversion-${b.id}`}>{conv}</Badge>
      <Badge variant="outline" className={whCls} data-testid={`status-webhook-${b.id}`}>{wh}</Badge>
      {b.requiresGhlCleanup && <Badge variant="outline" className="text-amber-500 border-amber-500/30" data-testid={`status-ghl-cleanup-${b.id}`}>Delete GHL manually</Badge>}
    </div>
  );
}

function Row({ b, onAction, actionLabel }: { b: AiBooking; onAction: () => void; actionLabel: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 grid gap-3 md:grid-cols-[1.1fr_1.2fr_1.3fr_auto_1.2fr_auto] md:items-center" data-testid={`row-ai-booking-${b.id}`}>
      <div>
        <p className="font-semibold text-sm">{specialLabel(b.special)}</p>
        <p className="text-xs text-muted-foreground capitalize">{b.status} · {b.conversionState === "converted" ? "App owned" : b.botOrigin === "voice_bot" ? "Voice bot" : "Chat bot"}</p>
      </div>
      <div className="text-sm min-w-0">
        <p className="font-medium truncate">{b.customer.name || "Name missing"}</p>
        <p className="text-xs text-muted-foreground truncate">{[b.customer.phone, b.customer.email].filter(Boolean).join(" · ") || "No contact details"}</p>
      </div>
      <div className="text-sm">
        <p>{fmtHalifax(b.appointmentAt)}</p>
        <p className="text-xs text-muted-foreground capitalize">{[b.vehicle.type, b.vehicle.make, b.vehicle.model].filter(Boolean).join(" ") || "Vehicle type missing"}</p>
      </div>
      <div className="text-sm font-semibold" data-testid={`text-price-${b.id}`}>{money(b.totalEstimate)}</div>
      <StateBadges b={b} />
      <Button size="sm" variant="outline" className="border-border" onClick={onAction} data-testid={`button-review-${b.id}`}>{actionLabel}</Button>
    </div>
  );
}

function Section({ title, hint, items, empty, actionLabel, onAction }: {
  title: string; hint?: string; items: AiBooking[]; empty: string; actionLabel: string; onAction: (b: AiBooking) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{title} <span className="text-foreground">({items.length})</span></h3>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {items.length === 0
        ? <div className="border border-dashed border-border rounded-lg p-6 text-center text-sm text-muted-foreground">{empty}</div>
        : items.map(b => <Row key={b.id} b={b} onAction={() => onAction(b)} actionLabel={actionLabel} />)}
    </section>
  );
}

type Form = { name: string; email: string; phone: string; type: string; year: string; make: string; model: string; colour: string; notes: string };
const toForm = (b: AiBooking): Form => ({
  name: b.customer.name ?? "", email: b.customer.email ?? "", phone: b.customer.phone ?? "",
  type: b.vehicle.type ?? "", year: b.vehicle.year ? String(b.vehicle.year) : "",
  make: b.vehicle.make ?? "", model: b.vehicle.model ?? "", colour: b.vehicle.colour ?? "", notes: b.notes ?? "",
});

function errMessage(e: unknown): { message: string; fields: string[] } {
  const err = e as { status?: number; data?: any; message?: string };
  const d = err?.data;
  const fields: string[] = [];
  const raw = d?.fields ?? d?.errors ?? d?.details;
  if (Array.isArray(raw)) raw.forEach((x: any) => fields.push(typeof x === "string" ? x : `${x.field ?? x.path ?? ""}: ${x.message ?? ""}`));
  else if (raw && typeof raw === "object") Object.entries(raw).forEach(([k, v]) => fields.push(`${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`));
  return { message: d?.error ?? d?.message ?? err?.message ?? "Request failed", fields };
}

function ReviewSheet({ booking, onClose, onSaved, onConverted, onOpenBooking, onSettled, onResolved }: {
  booking: AiBooking | null; onClose: () => void; onSettled: () => void; onResolved: (b: AiBooking) => void;
  onSaved: (b: AiBooking) => void; onConverted: (b: AiBooking) => void; onOpenBooking: () => void;
}) {
  const save = useAdminSaveAiBooking();
  const convert = useAdminConvertAiBooking();
  const resolve = useAdminResolveAiBookingWebhook();
  const [checked, setChecked] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<{ message: string; fields: string[] } | null>(null);
  const id = booking?.id;
  const frozenKey = booking ? `${booking.webhookState}|${booking.conversionState}` : "";
  useEffect(() => { if (booking) { setForm(toForm(booking)); setErrors(null); setChecked(false); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, frozenKey]);
  if (!booking || !form) return <Sheet open={false}><SheetContent /></Sheet>;

  const busy = save.isPending || convert.isPending || resolve.isPending;
  const set = (k: keyof Form, v: string) => setForm(f => f && { ...f, [k]: v });
  const digits = form.phone.replace(/\D/g, "");
  const phoneBad = digits.length > 15;
  const yearNum = form.year.trim() ? Number(form.year) : null;
  const yearBad = yearNum != null && (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > new Date().getFullYear() + 2);
  const emailBad = !!form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const typeOk = ["car", "suv", "truck", "van"].includes(form.type);
  const converted = booking.conversionState === "converted";
  const needsVerify = booking.webhookState === "uncertain" || booking.webhookState === "sending" || booking.conversionState === "processing";
   const frozen = !!booking.calendarEventId || booking.webhookState !== "pending" || booking.conversionState === "processing";
  const lockFields = converted || frozen;
  const webhookLocked = booking.webhookState === "uncertain" || booking.webhookState === "sending";
  const canConvert = isActive(booking) && !busy && !converted && !webhookLocked && booking.conversionState !== "processing" && !!form.name.trim() && digits.length >= 7 && !phoneBad && typeOk && !yearBad && !emailBad;
  const canSave = !busy && !converted && !frozen && typeOk && !yearBad && !emailBad && (!form.phone.trim() || (digits.length >= 7 && !phoneBad));
  const retry = booking.conversionState === "failed" && !converted;

  const body = (): AiBookingReviewBody => frozen ? bodyOf(toForm(booking)) : bodyOf(form);
  const bodyOf = (form: Form): AiBookingReviewBody => ({
    customer: { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() },
    vehicle: { type: form.type as AiBookingReviewBody["vehicle"]["type"], year: form.year.trim() ? Number(form.year) : null, make: form.make.trim(), model: form.model.trim(), colour: form.colour.trim() },
    notes: form.notes.trim(),
  });
  const run = (kind: "save" | "convert") => {
    setErrors(null);
    const m = kind === "save" ? save : convert;
    m.mutate({ id: booking.id, data: body() }, {
      onSettled: () => onSettled(),
      onSuccess: (res: AiBooking) => { setForm(toForm(res)); if (kind === "save") onSaved(res); else onConverted(res); },
      onError: (e: unknown) => setErrors(e && (e as any).status === 503
        ? { message: "SQL setup needed: the AI bookings tables have not been created yet.", fields: [] } : errMessage(e)),
    });
  };
  const verify = (delivered: boolean) => {
    setErrors(null);
    resolve.mutate({ id: booking.id, data: { verifiedInGhl: true, delivered } }, {
      onSettled: () => onSettled(),
      onSuccess: (res: AiBooking) => { setChecked(false); onResolved(res); },
      onError: (e: unknown) => setErrors(errMessage(e)),
    });
  };
  const inp = "bg-surface-2 border-border h-9 text-sm";
  const lbl = "text-xs text-muted-foreground mb-1 block";
  const lastError = errors?.message ?? booking.lastError;

  return (
    <Sheet open onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto bg-background border-border p-0">
        <SheetHeader className="px-6 py-5 border-b border-border sticky top-0 bg-background z-10">
          <SheetTitle>Review {specialLabel(booking.special)}</SheetTitle>
        </SheetHeader>
        <div className="px-6 py-6 space-y-5">
          <div className="bg-card border border-border rounded-lg p-4 grid grid-cols-2 gap-y-1.5 text-sm">
            <span className="text-muted-foreground">GHL appointment</span><span data-testid="text-ghl-schedule">{fmtHalifax(booking.appointmentAt)}</span>
            <span className="text-muted-foreground">Ends</span><span>{fmtHalifax(booking.appointmentEndAt)}</span>
            <span className="text-muted-foreground">App booking ID</span><span className="font-mono text-xs break-all select-all">{booking.id}</span>
            <span className="text-muted-foreground">Original GHL ID</span><span className="font-mono text-xs break-all select-all" data-testid="text-ghl-id">{booking.ghlAppointmentId}</span>
            <span className="text-muted-foreground">Price</span><span className="font-semibold">{money(booking.totalEstimate)}</span>
            <p className="col-span-2 text-xs text-muted-foreground pt-2">{converted ? "This booking is app-owned. Reschedule or cancel it in the usual Bookings tab." : "Before conversion, schedule changes are made in GoHighLevel. Conversion transfers ownership to the app."}</p>
          </div>
          {booking.requiresGhlCleanup && (
            <div className="border border-amber-500/30 bg-amber-500/10 text-amber-500 rounded-lg p-3 text-sm" data-testid="alert-ghl-cleanup">
              <p className="font-semibold">Delete the original GHL appointment manually</p>
              <p>{booking.ghlDeleteError || "The API delete was not confirmed."}</p>
              <p className="text-xs mt-1">The app booking and its Google event are kept. Delete the original appointment using the GHL ID above; do not cancel it.</p>
            </div>
          )}

          {webhookLocked && (
            <div className="flex gap-2 border border-amber-500/30 bg-amber-500/10 text-amber-500 rounded-lg p-3 text-sm" data-testid="alert-webhook-uncertain">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Booking-confirmed delivery is {booking.webhookState}. Verify automation delivery in GoHighLevel before doing anything else; conversion retry is disabled to avoid a duplicate confirmation.</span>
            </div>
          )}
          {needsVerify && !converted && (
            <div className="border border-border bg-card rounded-lg p-4 space-y-3" data-testid="panel-verify-webhook">
              <p className="text-sm font-semibold">Verify booking-confirmed automation</p>
              <label className="flex gap-2 text-sm items-start cursor-pointer">
                <input type="checkbox" className="mt-1" checked={checked} onChange={e => setChecked(e.target.checked)} data-testid="checkbox-verified-ghl" />
                <span>I checked the booking-confirmed automation history in GoHighLevel for this customer.</span>
              </label>
              <p className="text-xs text-amber-500">Do not mark "not delivered" without checking. A wrong answer may send a duplicate confirmation. In-progress requests have a 2-minute safety wait before verification.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!checked || busy} onClick={() => verify(true)} data-testid="button-mark-delivered">
                  {resolve.isPending ? "Saving…" : "Mark delivered"}</Button>
                <Button size="sm" variant="outline" className="border-border" disabled={!checked || busy} onClick={() => verify(false)} data-testid="button-mark-not-delivered">Mark not delivered</Button>
              </div>
            </div>
          )}
          {retry && (
            <div className="border border-border bg-card rounded-lg p-3 text-sm text-muted-foreground" data-testid="alert-calendar-retry">
              Retrying resumes unfinished steps only. A recorded Google event, completed GHL delete, and acknowledged webhook are not repeated.
            </div>
          )}
          {lastError && (
            <div className="flex gap-2 border border-red-500/30 bg-red-500/10 text-red-400 rounded-lg p-3 text-sm" data-testid="text-last-error">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div><p>{lastError}</p>{errors?.fields.map((f, i) => <p key={i} className="text-xs mt-1">{f}</p>)}</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className={lbl}>Name *</label><Input className={inp} value={form.name} onChange={e => set("name", e.target.value)} disabled={lockFields} data-testid="input-ai-name" /></div>
            <div><label className={lbl}>Phone *</label><Input className={inp} value={form.phone} onChange={e => set("phone", e.target.value)} disabled={lockFields} data-testid="input-ai-phone" />
              {phoneBad && <p className="text-[11px] text-red-400 mt-1">Phone can have at most 15 digits</p>}
              {digits.length < 7 && !phoneBad && <p className="text-[11px] text-amber-500 mt-1">Usable phone needed to convert</p>}</div>
            <div><label className={lbl}>Email</label><Input className={inp} value={form.email} onChange={e => set("email", e.target.value)} disabled={lockFields} data-testid="input-ai-email" />
              {emailBad && <p className="text-[11px] text-red-400 mt-1">Enter a valid email</p>}</div>
            <div><label className={lbl}>Vehicle type *</label>
              <Select value={form.type} onValueChange={v => set("type", v)} disabled={lockFields}>
                <SelectTrigger className={inp} data-testid="select-ai-type"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>{["car", "suv", "truck", "van"].map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">Price is set by the server from vehicle type.</p></div>
            <div><label className={lbl}>Year</label><Input className={inp} inputMode="numeric" value={form.year} onChange={e => set("year", e.target.value)} disabled={lockFields} data-testid="input-ai-year" />
              {yearBad && <p className="text-[11px] text-red-400 mt-1">Enter a valid year</p>}</div>
            <div><label className={lbl}>Make</label><Input className={inp} value={form.make} onChange={e => set("make", e.target.value)} disabled={lockFields} data-testid="input-ai-make" /></div>
            <div><label className={lbl}>Model</label><Input className={inp} value={form.model} onChange={e => set("model", e.target.value)} disabled={lockFields} data-testid="input-ai-model" /></div>
            <div className="col-span-2"><label className={lbl}>Colour</label><Input className={inp} value={form.colour} onChange={e => set("colour", e.target.value)} disabled={lockFields} data-testid="input-ai-colour" /></div>
            <div className="col-span-2"><label className={lbl}>Notes</label><Textarea className="bg-surface-2 border-border text-sm" rows={4} maxLength={4000} value={form.notes} onChange={e => set("notes", e.target.value)} disabled={lockFields} data-testid="input-ai-notes" /></div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" className="border-border" disabled={!canSave} onClick={() => run("save")} data-testid="button-save-ai">
              {save.isPending ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : "Save details"}
            </Button>
            <Button disabled={!canConvert} onClick={() => run("convert")} data-testid="button-convert-ai">
              {convert.isPending ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Converting…</> : retry ? "Resume conversion" : "Convert to booking"}
            </Button>
            {converted && <Button variant="ghost" onClick={onOpenBooking} data-testid="button-open-booking-sheet">Open booking</Button>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function AiBookingsTab({ onOpenBooking }: { onOpenBooking: (bookingId: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, error, refetch, isFetching } = useAdminListAiBookings({
    query: { queryKey: getAdminListAiBookingsQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true, refetchOnMount: "always", retry: false },
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = useMemo(() => data ?? [], [data]);
  const queue = list.filter(b => b.conversionState !== "converted" && isActive(b));
  const history = list.filter(b => b.conversionState === "converted");
  const inactive = list.filter(b => b.conversionState !== "converted" && !isActive(b));
  const selected = list.find(b => b.id === selectedId) ?? null;

  const patch = (b: AiBooking) =>
    qc.setQueryData<AiBooking[]>(getAdminListAiBookingsQueryKey(), old => old?.map(x => (x.id === b.id ? b : x)));
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getAdminListAiBookingsQueryKey() });
    qc.invalidateQueries({ queryKey: getAdminListBookingsQueryKey({}) });
    qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && /calendar|admin\/bookings/.test(q.queryKey[0] as string) });
  };

  if (isLoading) return <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  if (error) {
    const unavailable = (error as any)?.status === 503;
    return (
      <div className="border border-border bg-card rounded-lg p-8 text-center space-y-3" data-testid="state-ai-error">
        <AlertTriangle className="h-6 w-6 mx-auto text-amber-500" />
        <p className="font-semibold">{unavailable ? "SQL setup needed" : "Couldn't load AI bookings"}</p>
          <p className="text-sm text-muted-foreground">{unavailable ? "Run the latest scripts/migrate-ai-booking-conversions.sql in Supabase, even if you ran an earlier version, then retry." : errMessage(error).message}</p>
        <Button variant="outline" onClick={() => refetch()} data-testid="button-retry-ai">Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><p className="text-sm text-muted-foreground">Chat and voice-bot specials only. Convert creates the app Google event, deletes the GHL appointment, then sends confirmation.</p></div>
        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-ai"><RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button>
      </div>
      <Section title="Review queue" hint="Only explicit chat/voice-bot origins are included. Unknown origins are excluded; bot-specific webhook intake can supply bookingOrigin." items={queue} empty="No verified bot bookings waiting. App and Google-origin appointments do not appear here." actionLabel="Review" onAction={b => setSelectedId(b.id)} />
      <Section title="Converted history" items={history} empty="No converted specials yet." actionLabel="Details" onAction={b => setSelectedId(b.id)} />
      {history.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {history.map(b => (
            <div key={b.id} className="text-xs text-muted-foreground bg-card border border-border rounded-lg p-3 space-y-1" data-testid={`receipt-${b.id}`}>
              <p className="text-foreground font-medium flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-green-500" />{b.customer.name || "Customer"} · {fmtHalifax(b.convertedAt)}</p>
              <p>Google event: <span className="font-mono break-all">{b.calendarEventId ?? "not created"}</span></p>
              <p>Delivery: {b.webhookState}</p>
              <p>Original GHL appointment: {b.ghlDeleteState}</p>
              {b.requiresGhlCleanup && <p className="text-amber-500" data-testid={`receipt-ghl-cleanup-${b.id}`}>Manual delete required · <span className="font-mono break-all select-all">{b.ghlAppointmentId}</span></p>}
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onOpenBooking(b.id)} data-testid={`button-open-booking-${b.id}`}><ExternalLink className="h-3 w-3 mr-1" />Open booking</Button>
            </div>
          ))}
        </div>
      )}
      <Section title="Inactive imports" hint="Cancelled or otherwise not convertible." items={inactive} empty="None." actionLabel="View" onAction={b => setSelectedId(b.id)} />
      <ReviewSheet
        booking={selected}
        onSettled={invalidate}
        onResolved={b => { patch(b); toast({ title: b.webhookState === "sent" ? "Marked delivered" : "Marked not delivered" }); }}
        onClose={() => setSelectedId(null)}
        onSaved={b => { patch(b); invalidate(); toast({ title: "Details saved" }); }}
        onConverted={b => {
          patch(b); invalidate();
          if (b.conversionState === "converted") { setSelectedId(null); toast({
            title: b.requiresGhlCleanup ? "Converted — GHL cleanup required" : "Converted to booking",
            description: b.requiresGhlCleanup ? "App Google event created and confirmation sent. Delete the original GHL appointment manually." : "App Google event created, original GHL appointment deleted, and confirmation sent.",
          }); }
          else toast({ variant: "destructive", title: "Conversion incomplete", description: b.lastError ?? "Review the error and retry." });
        }}
        onOpenBooking={() => { if (selected) { setSelectedId(null); onOpenBooking(selected.id); } }}
      />
    </div>
  );
}
