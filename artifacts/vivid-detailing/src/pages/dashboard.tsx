import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCustomerDashboard,
  useGetCalendarNextSlots,
  useGetCalendarAvailability,
  useUpdateBooking,
} from "@workspace/api-client-react";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  CarFront, CalendarIcon, History, Shield, AlertCircle, Settings,
  Plus, Activity, Star, Trophy, Zap, Lock, Check, ChevronRight, ChevronLeft,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

// ── Tier config ──────────────────────────────────────────────────────────────
const TIERS = [
  {
    name: "Silver",
    threshold: 0,
    nextThreshold: 1000,
    color: "text-slate-300",
    bg: "bg-slate-400/10",
    border: "border-slate-400/30",
    badge: "bg-slate-400/20 text-slate-300 border-slate-400/30",
    perks: [
      "Priority booking — skip the waitlist",
      "10% off your 4th service",
      "Free air freshener with every service",
    ],
  },
  {
    name: "Black",
    threshold: 1000,
    nextThreshold: 3000,
    color: "text-white",
    bg: "bg-white/5",
    border: "border-white/20",
    badge: "bg-white/10 text-white border-white/20",
    perks: [
      "All Silver perks",
      "15% off add-ons on every visit",
      "Free decontamination wash annually",
      "Early access to seasonal promos",
    ],
  },
  {
    name: "Elite",
    threshold: 3000,
    nextThreshold: null,
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/30",
    badge: "bg-amber-400/15 text-amber-400 border-amber-400/30",
    perks: [
      "All Black perks",
      "20% lifetime discount on all services",
      "Complimentary annual PPF touch-up inspection",
      "Dedicated service advisor — direct line",
      "Free vehicle pick-up & drop-off",
    ],
  },
];

function getTierConfig(tierName: string) {
  return TIERS.find(t => t.name === tierName) ?? TIERS[0];
}

function TierBadge({ tier }: { tier: string }) {
  const cfg = getTierConfig(tier);
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border ${cfg.badge}`}>
      <Trophy className="h-3.5 w-3.5" />
      {tier} Member
    </span>
  );
}

function ProgressRing({ percent, size = 96, stroke = 7 }: { percent: number; size?: number; stroke?: number }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (percent / 100) * circ;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeWidth={stroke} fill="none" className="text-white/10" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeWidth={stroke} fill="none"
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" className="text-primary transition-all duration-700" />
    </svg>
  );
}

// ── Reschedule Sheet ─────────────────────────────────────────────────────────
function RescheduleSheet({
  booking, open, onClose, onSuccess,
}: { booking: any; open: boolean; onClose: () => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateBooking = useUpdateBooking();

  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saved, setSaved] = useState(false);

  // Reset on open/close
  useEffect(() => {
    if (!open) {
      setSelectedDate(undefined);
      setSelectedSlot(null);
      setShowDatePicker(false);
      setSaved(false);
    }
  }, [open]);

  const selectedDateStr = selectedDate
    ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`
    : undefined;

  const { data: nextSlots, isFetching: slotsFetching } = useGetCalendarNextSlots(
    { duration: 2, count: 3 },
    { query: { enabled: open } }
  );

  const { data: daySlots, isFetching: dayFetching } = useGetCalendarAvailability(
    { date: selectedDateStr!, duration: 2 },
    { query: { enabled: !!selectedDateStr && showDatePicker } }
  );

  const handleConfirm = async () => {
    if (!selectedSlot || !selectedDate) return;
    try {
      const dt = new Date(selectedDate);
      const [h, m] = selectedSlot.split(":");
      dt.setHours(parseInt(h), parseInt(m), 0, 0);
      await updateBooking.mutateAsync({ id: booking.id, data: { appointmentAt: dt.toISOString() } });
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${booking.customerId}/dashboard`] });
      toast({ title: "Appointment rescheduled!", description: `New time: ${format(dt, "EEEE, MMM d 'at' h:mm a")}` });
      setTimeout(() => { onSuccess(); onClose(); }, 1800);
    } catch {
      toast({ variant: "destructive", title: "Failed to reschedule", description: "Please try again." });
    }
  };

  const confirmLabel = selectedSlot && selectedDate
    ? `Confirm — ${format(selectedDate, "MMM d")} at ${(() => {
        const [h] = selectedSlot.split(":"); const hr = parseInt(h);
        return `${hr > 12 ? hr - 12 : hr}:00 ${hr >= 12 ? "PM" : "AM"}`;
      })()}`
    : "Select a time to continue";

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto bg-background border-border">
        <SheetHeader className="border-b border-border pb-4 mb-6">
          <SheetTitle>Reschedule Appointment</SheetTitle>
          {booking?.appointmentAt && (
            <p className="text-sm text-muted-foreground">
              Current: <span className="text-foreground font-medium">
                {format(new Date(booking.appointmentAt), "EEEE, MMM d 'at' h:mm a")}
              </span>
            </p>
          )}
        </SheetHeader>

        {saved ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
              <Check className="h-8 w-8 text-primary" />
            </div>
            <p className="font-semibold text-lg">Appointment Updated!</p>
            <p className="text-sm text-muted-foreground">You're all set. We'll see you at your new time.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Quick slots */}
            <div>
              <p className="text-sm font-semibold mb-3">Next available appointments</p>
              {slotsFetching ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-14 rounded-lg bg-accent animate-pulse" />)}
                </div>
              ) : (
                <div className="space-y-2">
                  {nextSlots?.slots?.map(slot => {
                    const slotDate = new Date(slot.date + "T00:00:00");
                    const isSelected = !showDatePicker && selectedSlot === slot.start && selectedDateStr === slot.date;
                    const spotsLeft = Math.max(1, (3 - slot.bookingsToday) - 1);
                    return (
                      <button
                        key={`${slot.date}-${slot.start}`}
                        type="button"
                        onClick={() => { setSelectedDate(slotDate); setSelectedSlot(slot.start); setShowDatePicker(false); }}
                        className={`flex items-center justify-between w-full px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground shadow-[0_0_12px_rgba(41,184,217,0.25)]"
                            : "border-border hover:border-primary/60 hover:bg-primary/5 text-foreground"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <CalendarIcon size={15} className={isSelected ? "text-primary-foreground/80" : "text-primary"} />
                          <div className="text-left">
                            <div>{format(slotDate, "EEEE, MMM d")}</div>
                            <div className={`text-xs font-normal mt-0.5 ${isSelected ? "text-primary-foreground/70" : "text-amber-400"}`}>
                              {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}>{slot.label}</span>
                          {isSelected && <Check size={14} />}
                        </div>
                      </button>
                    );
                  })}
                  {!slotsFetching && !nextSlots?.slots?.length && (
                    <p className="text-sm text-muted-foreground text-center py-4">No upcoming slots found. Choose a date below.</p>
                  )}
                </div>
              )}
            </div>

            {/* Custom date toggle */}
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm text-primary hover:underline w-full justify-center py-1"
              onClick={() => setShowDatePicker(v => !v)}
            >
              {showDatePicker ? <><ChevronLeft size={14} /> Hide calendar</> : <>Choose a different date <ChevronRight size={14} /></>}
            </button>

            {showDatePicker && (
              <div className="space-y-4">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={d => { setSelectedDate(d); setSelectedSlot(null); }}
                  disabled={(d) => d < new Date() || d.getDay() === 0}
                  className="rounded-md border border-border mx-auto"
                />
                {selectedDate && (
                  <div>
                    <p className="text-sm font-semibold mb-3">
                      Available times on {format(selectedDate, "MMMM d")}
                    </p>
                    {dayFetching ? (
                      <div className="grid grid-cols-3 gap-2">
                        {[...Array(5)].map((_, i) => <div key={i} className="h-9 rounded-lg bg-accent animate-pulse" />)}
                      </div>
                    ) : daySlots?.slots?.length ? (
                      <div className="grid grid-cols-3 gap-2">
                        {daySlots.slots.map(slot => {
                          const isSelected = selectedSlot === slot.start;
                          return (
                            <button
                              key={slot.start}
                              type="button"
                              onClick={() => setSelectedSlot(slot.start)}
                              className={`py-2 rounded-lg border text-sm font-medium transition-all ${
                                isSelected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border hover:border-primary/60 hover:bg-primary/5"
                              }`}
                            >
                              {slot.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-2">No availability on this date. Try another.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Confirm button */}
            <Button
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={!selectedSlot || !selectedDate || updateBooking.isPending}
              onClick={handleConfirm}
            >
              {updateBooking.isPending ? "Saving..." : confirmLabel}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function DashboardSkeleton() {
  return (
    <div className="container py-8 max-w-6xl animate-pulse">
      <div className="flex justify-between items-end mb-8">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-surface-2 rounded-lg" />
          <div className="h-4 w-64 bg-surface-2 rounded" />
        </div>
        <div className="h-10 w-36 bg-surface-2 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {[0, 1, 2].map(i => (
          <div key={i} className="bg-surface border border-border rounded-xl p-6 space-y-4">
            <div className="h-4 w-28 bg-surface-2 rounded" />
            <div className="h-8 w-32 bg-surface-2 rounded-lg" />
            <div className="h-2 w-full bg-surface-2 rounded-full" />
          </div>
        ))}
      </div>
      <div className="h-10 w-64 bg-surface-2 rounded-lg mb-6" />
      <div className="bg-surface border border-border rounded-xl p-6 space-y-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex items-center justify-between py-2">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-surface-2 rounded-md" />
              <div className="space-y-2">
                <div className="h-4 w-40 bg-surface-2 rounded" />
                <div className="h-3 w-28 bg-surface-2 rounded" />
              </div>
            </div>
            <div className="h-6 w-20 bg-surface-2 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const hasRef = !!new URLSearchParams(window.location.search).get("ref");

  // Start in "resolving" state if there's a ?ref= param so we never
  // flash "No account found" while the async lookup is in flight.
  const [refResolving, setRefResolving] = useState(hasRef);
  const [customerId, setCustomerId] = useState<string | null>(() => localStorage.getItem("vd_customer_id"));
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  // Magic link auto-login: ?ref=bookingId → always resolve so fresh data loads
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (!ref) return;
    setRefResolving(true);
    fetch(`/api/bookings/${ref}/customer`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.customerId) {
          localStorage.setItem("vd_customer_id", data.customerId);
          setCustomerId(data.customerId);
          // Always bust the cache so newest bookings are included
          queryClient.invalidateQueries({ queryKey: [`/api/customers/${data.customerId}/dashboard`] });
        }
      })
      .catch(() => {})
      .finally(() => setRefResolving(false));
  }, []);

  const { data: dashboard, isLoading } = useGetCustomerDashboard(customerId ?? "", {
    query: { enabled: !!customerId && !refResolving, retry: false }
  });

  const mockDashboard = {
    customer: { name: "Alex Driver", email: "alex@example.com" },
    vehicles: [
      { id: "1", make: "Porsche", model: "911", year: 2022, type: "car", licensePlate: "VIVID 1" }
    ],
    loyalty: {
      tier: "Black",
      lifetimeSpend: 1250,
      nextTierName: "Elite",
      nextTierThreshold: 3000,
      progressPercent: 12.5,
    },
    conditionScore: 85,
    maintenanceDue: true,
    upcomingBooking: {
      id: "b_1",
      appointmentAt: new Date(Date.now() + 86400000 * 3).toISOString(),
      status: "confirmed",
      totalEstimate: 249.00,
      items: [{ itemName: "Summer Special Ceramic" }]
    },
    recentBookings: [
      { id: "b_2", appointmentAt: new Date(Date.now() - 86400000 * 30).toISOString(), status: "completed", totalEstimate: 150.00, items: [{ itemName: "Interior Detail" }] },
      { id: "b_3", appointmentAt: new Date(Date.now() - 86400000 * 80).toISOString(), status: "completed", totalEstimate: 399.00, items: [{ itemName: "Ceramic Coating" }] },
      { id: "b_4", appointmentAt: new Date(Date.now() - 86400000 * 120).toISOString(), status: "completed", totalEstimate: 225.00, items: [{ itemName: "Full Detail + Decon" }] },
      { id: "b_5", appointmentAt: new Date(Date.now() - 86400000 * 200).toISOString(), status: "completed", totalEstimate: 476.00, items: [{ itemName: "PPF Hood & Fenders" }] },
    ]
  };

  // While the ?ref= magic link is resolving, always show skeleton (never "no account found")
  if (refResolving || (!!customerId && isLoading)) {
    return <DashboardSkeleton />;
  }

  if (!customerId) {
    return (
      <div className="container py-24 max-w-lg text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-surface flex items-center justify-center mb-6">
          <CarFront className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-2xl font-bold mb-3">No account found</h2>
        <p className="text-muted-foreground mb-8">
          Complete a booking first and your dashboard will be available here with your vehicles, service history, and loyalty status.
        </p>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setLocation("/book")}>
          Book Your First Service
        </Button>
      </div>
    );
  }

  const data = dashboard || mockDashboard;
  const loyalty = data.loyalty;
  const tier = getTierConfig(loyalty.tier);
  const allBookings = [...(data.recentBookings ?? [])];
  const totalPoints = Math.round(loyalty.lifetimeSpend);
  const spendToNext = loyalty.nextTierThreshold
    ? Math.max(0, loyalty.nextTierThreshold - loyalty.lifetimeSpend)
    : 0;

  return (
    <div className="container py-8 max-w-6xl">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold">Welcome back, {data.customer.name?.split(' ')[0] || 'Guest'}</h1>
          <p className="text-muted-foreground">Manage your vehicles and appointments.</p>
        </div>
        <Button onClick={() => setLocation("/book")} className="bg-primary text-primary-foreground hover:bg-primary/90">
          Book New Service
        </Button>
      </div>

      {data.maintenanceDue && (
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="text-primary h-5 w-5" />
            <div>
              <h4 className="font-semibold text-primary">Maintenance Wash Due</h4>
              <p className="text-sm text-primary/80">It's been over 4 weeks since your last wash. Keep your coating performing optimally.</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setLocation("/book?intent=clean")}>Schedule Now</Button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium flex items-center">
              <Shield className="mr-2 h-4 w-4" /> Loyalty Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TierBadge tier={loyalty.tier} />
            <div className="space-y-2 mt-4">
              <div className="flex justify-between text-xs">
                <span>${loyalty.lifetimeSpend.toFixed(0)} spent</span>
                {loyalty.nextTierName && (
                  <span className="text-muted-foreground">{loyalty.nextTierName} at ${loyalty.nextTierThreshold}</span>
                )}
              </div>
              <Progress value={loyalty.progressPercent} className="h-1.5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium flex items-center">
              <Activity className="mr-2 h-4 w-4" /> Vehicle Condition
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold text-primary">{data.conditionScore ?? "—"}/100</div>
              <p className="text-xs text-muted-foreground mt-1">Based on last inspection</p>
            </div>
            <div className="relative w-16 h-16 rounded-full border-4 border-surface-2 flex items-center justify-center">
              <svg className="absolute inset-0 w-full h-full transform -rotate-90">
                <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="none" className="text-primary"
                  strokeDasharray="175" strokeDashoffset={175 - (175 * (data.conditionScore || 0)) / 100} />
              </svg>
              <span className="text-sm font-bold">Good</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-primary text-primary-foreground border-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center opacity-90">
              <CalendarIcon className="mr-2 h-4 w-4" /> Next Appointment
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.upcomingBooking ? (
              <>
                <div className="text-xl font-bold mb-1">
                  {format(new Date(data.upcomingBooking.appointmentAt!), "MMM d, h:mm a")}
                </div>
                <p className="text-sm opacity-90 truncate">{data.upcomingBooking.items?.[0]?.itemName}</p>
                <div className="mt-4">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full bg-background/20 hover:bg-background/30 text-white border-none"
                    onClick={() => setRescheduleOpen(true)}
                  >
                    Reschedule
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-2">
                <p className="text-sm mb-3">No upcoming appointments</p>
                <Button size="sm" variant="secondary" className="w-full bg-background text-foreground hover:bg-background/90" onClick={() => setLocation("/book")}>
                  Book Now
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="vehicles" className="w-full">
        <TabsList className="mb-6 bg-surface border border-border">
          <TabsTrigger value="vehicles">My Vehicles</TabsTrigger>
          <TabsTrigger value="history">Service History</TabsTrigger>
          <TabsTrigger value="rewards">
            <Trophy className="h-3.5 w-3.5 mr-1.5" />Rewards
          </TabsTrigger>
        </TabsList>

        {/* ── Vehicles ── */}
        <TabsContent value="vehicles" className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {data.vehicles.map((v: any) => (
              <Card key={v.id} className="bg-surface border-border">
                <CardContent className="p-6 flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-surface-2 flex items-center justify-center">
                      <CarFront className="text-primary" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg">{v.year} {v.make} {v.model}</h3>
                      <p className="text-sm text-muted-foreground">{v.licensePlate} • {v.type}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon"><Settings className="h-4 w-4" /></Button>
                </CardContent>
              </Card>
            ))}
            <Card className="bg-surface/50 border-border border-dashed hover:border-primary/50 cursor-pointer transition-colors flex items-center justify-center p-6 min-h-[100px]">
              <div className="text-center">
                <Plus className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm font-medium">Add Vehicle</p>
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* ── Service History ── */}
        <TabsContent value="history">
          <Card className="bg-surface border-border">
            <div className="divide-y divide-border">
              {allBookings.map((b: any) => (
                <div key={b.id} className="p-4 flex items-center justify-between hover:bg-surface-2 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="bg-surface-2 p-2 rounded-md">
                      <History className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h4 className="font-medium">{b.items?.[0]?.itemName}</h4>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(b.appointmentAt), "MMMM d, yyyy")} • ${b.totalEstimate}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {(() => {
                      const isUpcoming = b.appointmentAt && new Date(b.appointmentAt) > new Date() && b.status !== "completed" && b.status !== "cancelled";
                      if (b.status === "cancelled") return <Badge variant="outline" className="text-red-400 border-red-400/20 bg-red-400/10">Cancelled</Badge>;
                      if (isUpcoming) return <Badge variant="outline" className="text-primary border-primary/20 bg-primary/10">Scheduled</Badge>;
                      return <Badge variant="outline" className="text-green-500 border-green-500/20 bg-green-500/10">Completed</Badge>;
                    })()}
                    <Button variant="ghost" size="sm" className="hidden sm:flex" onClick={() => setLocation("/book")}>Rebook</Button>
                  </div>
                </div>
              ))}
              {allBookings.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">No past services found.</div>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* ── Rewards ── */}
        <TabsContent value="rewards" className="space-y-6">
          {/* Hero card */}
          <Card className={`border ${tier.border} ${tier.bg} overflow-hidden relative`}>
            <div className="absolute inset-0 opacity-5 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary to-transparent pointer-events-none" />
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <div className="flex items-center gap-5">
                  <div className="relative">
                    <ProgressRing percent={loyalty.progressPercent} size={88} stroke={6} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Trophy className={`h-5 w-5 ${tier.color}`} />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Current Tier</p>
                    <h2 className={`text-3xl font-bold ${tier.color}`}>{loyalty.tier}</h2>
                    <TierBadge tier={loyalty.tier} />
                  </div>
                </div>
                <div className="flex-1 max-w-xs w-full">
                  <div className="flex justify-between items-baseline mb-2">
                    <span className="text-3xl font-bold tabular-nums">{totalPoints.toLocaleString()}</span>
                    <span className="text-sm text-muted-foreground">pts earned</span>
                  </div>
                  <Progress value={loyalty.progressPercent} className="h-2 mb-2" />
                  {loyalty.nextTierName ? (
                    <p className="text-xs text-muted-foreground">
                      <span className="text-foreground font-semibold">${spendToNext.toFixed(0)}</span> more to reach{" "}
                      <span className={`font-semibold ${getTierConfig(loyalty.nextTierName).color}`}>{loyalty.nextTierName}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-primary font-semibold">You've reached the highest tier — enjoy every perk!</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Points history */}
            <Card className="bg-surface border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Star className="h-4 w-4 text-primary" /> Points History
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {allBookings.filter((b: any) => b.status === "completed").map((b: any) => {
                    const pts = Math.round(Number(b.totalEstimate));
                    return (
                      <div key={b.id} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-sm font-medium">{b.items?.[0]?.itemName ?? "Service"}</p>
                          <p className="text-xs text-muted-foreground">{format(new Date(b.appointmentAt), "MMM d, yyyy")}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-primary">+{pts.toLocaleString()} pts</p>
                          <p className="text-xs text-muted-foreground">${Number(b.totalEstimate).toFixed(2)}</p>
                        </div>
                      </div>
                    );
                  })}
                  {allBookings.filter((b: any) => b.status === "completed").length === 0 && (
                    <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                      Complete your first service to start earning points.
                    </div>
                  )}
                </div>
                <div className="border-t border-border px-4 py-3 flex justify-between">
                  <span className="text-sm text-muted-foreground">Lifetime total</span>
                  <span className="text-sm font-bold">{totalPoints.toLocaleString()} pts</span>
                </div>
              </CardContent>
            </Card>

            {/* Tier progression */}
            <div className="space-y-3">
              {TIERS.map(t => {
                const isCurrentTier = t.name === loyalty.tier;
                const isUnlocked = (loyalty.lifetimeSpend ?? 0) >= t.threshold;
                const isLocked = !isUnlocked;
                return (
                  <Card key={t.name} className={`border transition-all ${isCurrentTier ? `${t.border} ${t.bg}` : "border-border bg-surface"} ${isLocked ? "opacity-60" : ""}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {isLocked ? <Lock className="h-4 w-4 text-muted-foreground" /> : <Trophy className={`h-4 w-4 ${t.color}`} />}
                          <span className={`font-bold ${isLocked ? "text-muted-foreground" : t.color}`}>{t.name}</span>
                          {isCurrentTier && <Badge variant="outline" className={`text-xs ${t.badge}`}>Current</Badge>}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {t.nextThreshold ? `$${t.threshold}–$${t.nextThreshold - 1}` : `$${t.threshold}+`}
                        </span>
                      </div>
                      <ul className="space-y-1">
                        {t.perks.map((perk, j) => (
                          <li key={j} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <Zap className={`h-3 w-3 mt-0.5 shrink-0 ${isUnlocked ? "text-primary" : "text-muted-foreground/40"}`} />
                            {perk}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          <div className="text-center">
            <p className="text-xs text-muted-foreground">$1 spent = 1 point. Points are calculated from your total booking spend including HST.</p>
          </div>
        </TabsContent>
      </Tabs>

      {/* Reschedule sheet */}
      <RescheduleSheet
        booking={data.upcomingBooking}
        open={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        onSuccess={() => setRescheduleOpen(false)}
      />
    </div>
  );
}
