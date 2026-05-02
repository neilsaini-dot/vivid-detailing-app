import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Droplet, Sun, Shield, Settings,
  ChevronRight, ArrowLeft, Plus, Check, CalendarIcon, Info, User, Phone
} from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

import {
  useListServices, useListAddOns, useCalculatePrice, useCreateBooking, useCaptureLead,
  PriceCalculateBodyVehicleType, CreateVehicleBodyType
} from "@workspace/api-client-react";

type VehicleType = "car" | "suv" | "truck" | "van";
type Intent = "clean" | "protect" | "tint" | "paint" | "quote";

interface BookingState {
  customer: { name: string; email: string; phone: string; };
  vehicle: { type: VehicleType; yearMakeModel: string; colour: string; };
  intent?: Intent;
  serviceIds: string[];
  addOnIds: string[];
  promoIds: string[];
  appointmentAt?: Date;
  timeSlot?: string;
  notes: string;
  depositPaid: boolean;
}

const initialState: BookingState = {
  customer: { name: "", email: "", phone: "" },
  vehicle: { type: "car", yearMakeModel: "", colour: "" },
  serviceIds: [], addOnIds: [], promoIds: [],
  notes: "", depositPaid: false,
};

const STEPS = 8;
const TIME_SLOTS = ["08:00", "10:00", "12:00", "14:00", "16:00"];

/* ── Vehicle silhouette SVGs ── */
function CarIcon({ active }: { active: boolean }) {
  const c = active ? "#29B8D9" : "currentColor";
  return (
    <svg viewBox="0 0 88 44" className="w-20 h-10" fill="none">
      <rect x="4" y="26" width="80" height="13" rx="3" fill={c} opacity="0.25"/>
      <path d="M8 26 L20 13 Q24 8 31 8 L57 8 Q64 8 68 13 L80 26 Z" fill={c}/>
      <rect x="22" y="10" width="18" height="13" rx="2" fill={active ? "#fff" : "#aaa"} opacity="0.3"/>
      <rect x="43" y="10" width="18" height="13" rx="2" fill={active ? "#fff" : "#aaa"} opacity="0.3"/>
      <circle cx="22" cy="39" r="5" fill={c}/>
      <circle cx="66" cy="39" r="5" fill={c}/>
    </svg>
  );
}
function SuvIcon({ active }: { active: boolean }) {
  const c = active ? "#29B8D9" : "currentColor";
  return (
    <svg viewBox="0 0 88 44" className="w-20 h-10" fill="none">
      <rect x="4" y="26" width="80" height="13" rx="3" fill={c} opacity="0.25"/>
      <path d="M6 26 L14 8 Q17 4 24 4 L64 4 Q71 4 74 8 L82 26 Z" fill={c}/>
      <rect x="16" y="6" width="16" height="17" rx="2" fill={active ? "#fff" : "#aaa"} opacity="0.3"/>
      <rect x="36" y="6" width="16" height="17" rx="2" fill={active ? "#fff" : "#aaa"} opacity="0.3"/>
      <rect x="56" y="6" width="10" height="17" rx="2" fill={active ? "#fff" : "#aaa"} opacity="0.3"/>
      <circle cx="20" cy="39" r="5" fill={c}/>
      <circle cx="68" cy="39" r="5" fill={c}/>
    </svg>
  );
}
function TruckIcon({ active }: { active: boolean }) {
  const c = active ? "#29B8D9" : "currentColor";
  return (
    <svg viewBox="0 0 88 44" className="w-20 h-10" fill="none">
      <rect x="4" y="26" width="80" height="13" rx="3" fill={c} opacity="0.25"/>
      <path d="M6 26 L12 10 Q15 6 22 6 L48 6 L48 26 Z" fill={c}/>
      <rect x="48" y="14" width="34" height="12" rx="2" fill={c} opacity="0.6"/>
      <rect x="14" y="8" width="16" height="15" rx="2" fill={active ? "#fff" : "#aaa"} opacity="0.3"/>
      <rect x="34" y="8" width="11" height="15" rx="2" fill={active ? "#fff" : "#aaa"} opacity="0.3"/>
      <circle cx="20" cy="39" r="5" fill={c}/>
      <circle cx="66" cy="39" r="5" fill={c}/>
    </svg>
  );
}
function VanIcon({ active }: { active: boolean }) {
  const c = active ? "#29B8D9" : "currentColor";
  return (
    <svg viewBox="0 0 88 44" className="w-20 h-10" fill="none">
      <rect x="4" y="26" width="80" height="13" rx="3" fill={c} opacity="0.25"/>
      <path d="M6 26 L10 6 Q13 3 20 3 L70 3 Q77 3 80 8 L82 26 Z" fill={c}/>
      <rect x="12" y="5" width="14" height="18" rx="2" fill={active ? "#fff" : "#aaa"} opacity="0.3"/>
      <rect x="30" y="5" width="14" height="18" rx="2" fill={active ? "#fff" : "#aaa"} opacity="0.3"/>
      <rect x="52" y="5" width="14" height="18" rx="2" fill={active ? "#fff" : "#aaa"} opacity="0.3"/>
      <circle cx="20" cy="39" r="5" fill={c}/>
      <circle cx="68" cy="39" r="5" fill={c}/>
    </svg>
  );
}

function parseYMM(raw: string): { year?: number; make: string; model: string } {
  const parts = raw.trim().split(/\s+/);
  const yr = parseInt(parts[0] ?? "");
  if (!isNaN(yr) && parts[0].length === 4 && yr > 1900) {
    return { year: yr, make: parts[1] ?? "", model: parts.slice(2).join(" ") };
  }
  return { make: raw.trim(), model: "" };
}

const slideVariants = {
  enter: (d: number) => ({ x: d > 0 ? 800 : -800, opacity: 0 }),
  center: { x: 0, opacity: 1, zIndex: 1 },
  exit: (d: number) => ({ x: d < 0 ? 800 : -800, opacity: 0, zIndex: 0 }),
};

export default function BookingFlow() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [dir, setDir] = useState(1);
  const [state, setState] = useState<BookingState>(initialState);
  const [currentPricing, setCurrentPricing] = useState<any>(null);

  const [capturedLeadId, setCapturedLeadId] = useState<string | null>(null);

  const { data: services = [] } = useListServices(
    state.intent ? { goal: state.intent } : {}
  );
  const { data: addOns = [] } = useListAddOns({ vehicleType: state.vehicle.type as any });
  const calculatePrice = useCalculatePrice();
  const createBooking = useCreateBooking();
  const captureLead = useCaptureLead();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const intentParam = params.get("intent") as Intent;
    const vltParam = params.get("vlt");
    if (intentParam && ["clean", "protect", "tint", "paint"].includes(intentParam)) {
      setState(s => ({ ...s, intent: intentParam }));
    }
  }, []);

  useEffect(() => {
    if (state.serviceIds.length > 0 || state.addOnIds.length > 0) {
      calculatePrice.mutate({
        data: {
          vehicleType: state.vehicle.type as PriceCalculateBodyVehicleType,
          serviceIds: state.serviceIds,
          addOnIds: state.addOnIds,
        }
      }, { onSuccess: (d) => setCurrentPricing(d) });
    } else {
      setCurrentPricing(null);
    }
  }, [state.vehicle.type, state.serviceIds, state.addOnIds]);

  const go = (delta: number) => { setDir(delta); setStep(s => Math.min(Math.max(s + delta, 1), STEPS)); };

  const handleStep1Continue = async () => {
    if (!capturedLeadId) {
      try {
        const result = await captureLead.mutateAsync({
          data: { name: state.customer.name, phone: state.customer.phone }
        });
        setCapturedLeadId(result.id);
      } catch {
        // Non-blocking — proceed even if lead save fails
      }
    }
    go(1);
  };

  const updateCustomer = (d: Partial<BookingState["customer"]>) => setState(s => ({ ...s, customer: { ...s.customer, ...d } }));
  const updateVehicle = (d: Partial<BookingState["vehicle"]>) => setState(s => ({ ...s, vehicle: { ...s.vehicle, ...d } }));
  const toggleService = (id: string) => setState(s => ({ ...s, serviceIds: s.serviceIds.includes(id) ? s.serviceIds.filter(x => x !== id) : [...s.serviceIds, id] }));
  const toggleAddon = (id: string) => setState(s => ({ ...s, addOnIds: s.addOnIds.includes(id) ? s.addOnIds.filter(x => x !== id) : [...s.addOnIds, id] }));

  const handleSubmit = async () => {
    try {
      const dt = state.appointmentAt ? new Date(state.appointmentAt) : undefined;
      if (dt && state.timeSlot) {
        const [h, m] = state.timeSlot.split(":");
        dt.setHours(parseInt(h), parseInt(m), 0, 0);
      }
      const ymm = parseYMM(state.vehicle.yearMakeModel);
      await createBooking.mutateAsync({
        data: {
          existingCustomerId: capturedLeadId ?? undefined,
          customer: state.customer,
          vehicle: {
            type: state.vehicle.type as CreateVehicleBodyType,
            year: ymm.year,
            make: ymm.make,
            model: ymm.model,
            colour: state.vehicle.colour,
          },
          serviceIds: state.serviceIds,
          addOnIds: state.addOnIds,
          promoIds: state.promoIds,
          appointmentAt: dt?.toISOString(),
          notes: state.notes,
          totalEstimate: currentPricing?.total,
        }
      });
      toast({ title: "Booking Confirmed", description: "Your appointment has been scheduled." });
      go(1);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to create booking. Please try again." });
    }
  };

  const canNext =
    (step === 1 && !!state.customer.name && !!state.customer.phone) ||
    (step === 2 && !!state.intent) ||
    (step === 3 && (state.serviceIds.length > 0 || state.promoIds.length > 0)) ||
    (step === 4) ||
    (step === 5) ||
    (step === 6) ||
    (step === 7 && !!state.appointmentAt && !!state.timeSlot && !!state.customer.email);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background flex flex-col md:flex-row">
      <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full px-4 py-8 relative">
        <div className="mb-8">
          <Progress value={(step / STEPS) * 100} className="h-1.5" />
          <p className="text-sm text-muted-foreground mt-2 font-medium">Step {step} of {STEPS}</p>
        </div>

        <div className="flex-1 relative min-h-[480px]">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ x: { type: "spring", stiffness: 300, damping: 30 }, opacity: { duration: 0.15 } }}
              className="w-full absolute"
            >

              {/* ── Step 1: Name + Phone + Vehicle ── */}
              {step === 1 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Let's get started</h2>
                    <p className="text-muted-foreground">Your info and vehicle — takes under a minute.</p>
                  </div>

                  {/* Name + Phone */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Your Name</Label>
                      <div className="relative">
                        <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="name"
                          className="pl-9"
                          placeholder="Jane Smith"
                          value={state.customer.name}
                          onChange={e => updateCustomer({ name: e.target.value })}
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone Number</Label>
                      <div className="relative">
                        <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="phone"
                          type="tel"
                          className="pl-9"
                          placeholder="902-555-1234"
                          value={state.customer.phone}
                          onChange={e => updateCustomer({ phone: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Vehicle type */}
                  <div>
                    <Label className="mb-3 block">Vehicle Type</Label>
                    <div className="grid grid-cols-2 gap-3">
                      {([
                        { type: "car" as VehicleType, label: "Car / Sedan", Icon: CarIcon },
                        { type: "suv" as VehicleType, label: "SUV / Crossover", Icon: SuvIcon },
                        { type: "truck" as VehicleType, label: "Pickup Truck", Icon: TruckIcon },
                        { type: "van" as VehicleType, label: "Van / Minivan", Icon: VanIcon },
                      ]).map(({ type: t, label, Icon }) => (
                        <Card
                          key={t}
                          className={`cursor-pointer transition-all ${state.vehicle.type === t ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}
                          onClick={() => updateVehicle({ type: t })}
                        >
                          <CardContent className="flex flex-col items-center justify-center p-4 gap-2">
                            <div className={state.vehicle.type === t ? "text-primary" : "text-muted-foreground"}>
                              <Icon active={state.vehicle.type === t} />
                            </div>
                            <span className="font-semibold text-xs text-center">{label}</span>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>

                  {/* Year / Make / Model + Colour */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Year, Make & Model</Label>
                      <Input
                        placeholder="e.g. 2023 Honda Civic"
                        value={state.vehicle.yearMakeModel}
                        onChange={e => updateVehicle({ yearMakeModel: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Colour</Label>
                      <Input
                        placeholder="e.g. Midnight Black"
                        value={state.vehicle.colour}
                        onChange={e => updateVehicle({ colour: e.target.value })}
                      />
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">We only contact you about your appointment. No spam.</p>
                </div>
              )}

              {/* ── Step 2: Intent ── */}
              {step === 2 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">What brings you in?</h2>
                    <p className="text-muted-foreground">Select your primary goal to see recommended services.</p>
                  </div>
                  <div className="grid gap-4">
                    {[
                      { id: "clean",   title: "Clean my vehicle",    desc: "Interior & exterior detailing packages",  icon: Droplet },
                      { id: "protect", title: "Protect my vehicle",  desc: "Ceramic coatings & sealants",             icon: Shield  },
                      { id: "tint",    title: "Tint my windows",     desc: "Ceramic window films with UV & heat rejection", icon: Sun },
                      { id: "paint",   title: "Improve paint/gloss", desc: "Paint correction & polishing",            icon: Settings },
                    ].map(intent => (
                      <Card
                        key={intent.id}
                        className={`cursor-pointer transition-all ${state.intent === intent.id ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}
                        onClick={() => setState(s => ({ ...s, intent: intent.id as Intent }))}
                      >
                        <CardContent className="flex items-center p-4 gap-4">
                          <div className={`p-3 rounded-full ${state.intent === intent.id ? "bg-primary/20" : "bg-accent"}`}>
                            <intent.icon size={22} className={state.intent === intent.id ? "text-primary" : "text-muted-foreground"} />
                          </div>
                          <div>
                            <h3 className="font-semibold">{intent.title}</h3>
                            <p className="text-sm text-muted-foreground">{intent.desc}</p>
                          </div>
                          {state.intent === intent.id && <Check size={18} className="ml-auto text-primary shrink-0" />}
                        </CardContent>
                      </Card>
                    ))}
                    <Card
                      className="cursor-pointer hover:border-primary/50 transition-all border-dashed"
                      onClick={() => setLocation("/quote")}
                    >
                      <CardContent className="flex items-center justify-between p-4">
                        <div>
                          <h3 className="font-semibold">Request a Custom Quote</h3>
                          <p className="text-sm text-muted-foreground">For PPF or specialized work</p>
                        </div>
                        <ChevronRight className="text-muted-foreground" />
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}

              {/* ── Step 3: Services ── */}
              {step === 3 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Recommended Services</h2>
                    <p className="text-muted-foreground">Select one or more base services.</p>
                  </div>

                  {state.intent === "protect" && (
                    <Card className="border-primary bg-primary/5 relative overflow-hidden mb-2">
                      <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-bl-lg">
                        SUMMER SPECIAL
                      </div>
                      <CardContent className="p-5">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="text-lg font-bold text-primary">Summer Special Ceramic</h3>
                          <span className="font-bold text-primary">$249</span>
                        </div>
                        <p className="text-sm text-muted-foreground mb-4">1-year ceramic coating applied to all painted surfaces.</p>
                        <Button
                          variant={state.promoIds.includes("summer-special") ? "default" : "outline"}
                          className="w-full"
                          onClick={() => setState(s => ({ ...s, promoIds: s.promoIds.includes("summer-special") ? [] : ["summer-special"] }))}
                        >
                          {state.promoIds.includes("summer-special") ? <><Check className="mr-2 h-4 w-4" />Selected</> : "Select Special"}
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  <div className="grid gap-4">
                    {services.map(svc => (
                      <Card
                        key={svc.id}
                        className={`transition-all cursor-pointer ${state.serviceIds.includes(svc.id) ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
                        onClick={() => toggleService(svc.id)}
                      >
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start gap-3">
                            <div className="flex-1">
                              <h3 className="font-bold text-primary">{svc.name}</h3>
                              <p className="text-sm text-muted-foreground mt-1">{svc.description}</p>
                              {svc.includes?.length > 0 && (
                                <ul className="mt-2 space-y-0.5">
                                  {svc.includes.map((inc: string) => (
                                    <li key={inc} className="text-xs text-muted-foreground flex items-center gap-1.5">
                                      <Check size={11} className="text-primary shrink-0" />{inc}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <span className="font-bold text-primary text-lg">
                                ${svc.prices.find((p: any) => p.vehicleType === state.vehicle.type)?.price ?? svc.basePrice ?? "—"}
                              </span>
                              {state.serviceIds.includes(svc.id)
                                ? <div className="mt-2 flex items-center justify-end gap-1 text-primary text-xs font-semibold"><Check size={12} />Selected</div>
                                : <div className="mt-2 text-xs text-muted-foreground">Tap to select</div>
                              }
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {services.length === 0 && (
                      <p className="text-center text-muted-foreground py-12">No services found. Please go back and select a goal.</p>
                    )}
                  </div>
                </div>
              )}

              {/* ── Step 4: Add-ons ── */}
              {step === 4 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Enhance Your Package</h2>
                    <p className="text-muted-foreground">Optional add-ons to complete the detail.</p>
                  </div>
                  <div className="space-y-6">
                    {["Interior", "Exterior"].map(group => {
                      const grouped = addOns.filter((a: any) => a.categoryGroup === group);
                      if (!grouped.length) return null;
                      return (
                        <div key={group}>
                          <h3 className="text-base font-semibold mb-3 border-b border-border pb-2">{group} Upgrades</h3>
                          <div className="grid gap-2">
                            {grouped.map((addon: any) => (
                              <label key={addon.id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-primary/50 cursor-pointer">
                                <div className="flex items-center gap-3">
                                  <Checkbox
                                    checked={state.addOnIds.includes(addon.id)}
                                    onCheckedChange={c => toggleAddon(addon.id)}
                                  />
                                  <span className="font-medium text-sm">{addon.name}</span>
                                </div>
                                <span className="text-sm font-semibold text-primary">
                                  +${addon.prices.find((p: any) => p.vehicleType === state.vehicle.type)?.price ?? 0}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {addOns.length === 0 && <p className="text-muted-foreground text-center py-8">No add-ons available.</p>}
                  </div>
                </div>
              )}

              {/* ── Step 5: Smart Recommendations ── */}
              {step === 5 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Smart Recommendations</h2>
                    <p className="text-muted-foreground">Based on your selection, you might also benefit from these.</p>
                  </div>
                  <div className="grid gap-4">
                    {addOns.slice(0, 2).map((addon: any) => (
                      <Card key={addon.id} className="border-primary/40 bg-primary/5">
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                          <CardTitle className="text-base">{addon.name}</CardTitle>
                          <Badge className="bg-primary/20 text-primary border-0">Recommended</Badge>
                        </CardHeader>
                        <CardContent>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Highly suggested for {state.vehicle.type}s.</span>
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-primary">+${addon.prices.find((p: any) => p.vehicleType === state.vehicle.type)?.price ?? 0}</span>
                              <Button size="sm" variant={state.addOnIds.includes(addon.id) ? "default" : "outline"}
                                onClick={() => toggleAddon(addon.id)}>
                                {state.addOnIds.includes(addon.id) ? "Remove" : "Add"}
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {addOns.length === 0 && <p className="text-muted-foreground text-sm">Nothing to recommend at this time — your selection looks great!</p>}
                  </div>
                </div>
              )}

              {/* ── Step 6: Review Estimate ── */}
              {step === 6 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Review Estimate</h2>
                    <p className="text-muted-foreground">Review your selected services and pricing before booking.</p>
                  </div>
                  <Card className="bg-card border-border">
                    <CardContent className="p-6 space-y-4">
                      <h3 className="font-semibold text-lg border-b border-border pb-2 mb-4">Line Items</h3>
                      {currentPricing?.lineItems?.map((item: any, i: number) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span>{item.name} {item.isQuoteBased && <Badge variant="outline" className="ml-2 text-[10px]">Quote</Badge>}</span>
                          <span>{item.isQuoteBased ? "TBD" : `$${item.price?.toFixed(2)}`}</span>
                        </div>
                      ))}
                      {(!currentPricing?.lineItems?.length) && <p className="text-sm text-muted-foreground">No items selected.</p>}

                      <div className="border-t border-border pt-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Subtotal</span>
                          <span>${currentPricing?.subtotal?.toFixed(2) ?? "0.00"}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">HST (15%)</span>
                          <span>${currentPricing?.tax?.toFixed(2) ?? "0.00"}</span>
                        </div>
                        <div className="flex justify-between font-bold text-xl pt-2 border-t border-border mt-2">
                          <span>Total</span>
                          <span className="text-primary">${currentPricing?.total?.toFixed(2) ?? "0.00"}</span>
                        </div>
                      </div>

                      {currentPricing?.hasQuoteItems && (
                        <div className="bg-accent p-3 rounded-md flex items-start gap-2 mt-4">
                          <Info size={15} className="text-primary mt-0.5 shrink-0" />
                          <p className="text-xs text-muted-foreground">Your booking includes quote-based items. Final price is confirmed after vehicle inspection.</p>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-4 border-t border-border">
                        <div>
                          <Label>Pay 20% deposit now</Label>
                          <p className="text-xs text-muted-foreground">Secure your appointment instantly</p>
                        </div>
                        <Switch checked={state.depositPaid} onCheckedChange={c => setState(s => ({ ...s, depositPaid: c }))} />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* ── Step 7: Date + Time + Email + Notes ── */}
              {step === 7 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Choose a Date & Time</h2>
                    <p className="text-muted-foreground">Pick your preferred slot and confirm your email.</p>
                  </div>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <Label>Appointment Date</Label>
                      <Card className="p-2 border-border bg-card">
                        <Calendar
                          mode="single"
                          selected={state.appointmentAt}
                          onSelect={d => setState(s => ({ ...s, appointmentAt: d }))}
                          disabled={date => date < new Date()}
                          className="rounded-md"
                        />
                      </Card>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Time Slot</Label>
                        <Select value={state.timeSlot} onValueChange={v => setState(s => ({ ...s, timeSlot: v }))}>
                          <SelectTrigger><SelectValue placeholder="Select a time" /></SelectTrigger>
                          <SelectContent>
                            {TIME_SLOTS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input type="email" placeholder="jane@example.com"
                          value={state.customer.email}
                          onChange={e => updateCustomer({ email: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Notes (Optional)</Label>
                        <Textarea placeholder="Any specific concerns or requests?"
                          value={state.notes}
                          onChange={e => setState(s => ({ ...s, notes: e.target.value }))} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step 8: Confirmation ── */}
              {step === 8 && (
                <div className="space-y-6 text-center py-12">
                  <div className="mx-auto w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mb-6">
                    <Check className="w-10 h-10 text-primary" />
                  </div>
                  <h2 className="text-4xl font-bold mb-2">Booking Confirmed</h2>
                  <p className="text-muted-foreground max-w-md mx-auto mb-8">
                    Your appointment is set. We'll send a confirmation to {state.customer.email}.
                  </p>
                  <div className="max-w-sm mx-auto space-y-4">
                    <Button variant="outline" className="w-full">
                      <CalendarIcon className="mr-2 h-4 w-4" /> Add to Calendar
                    </Button>
                    <Button className="w-full bg-primary text-primary-foreground" onClick={() => setLocation("/dashboard")}>
                      View Dashboard
                    </Button>
                  </div>
                  <div className="mt-12 p-6 bg-card border border-border rounded-xl max-w-md mx-auto">
                    <h3 className="font-semibold mb-2">Create an Account</h3>
                    <p className="text-sm text-muted-foreground mb-4">Track your service history and earn loyalty rewards.</p>
                    <Button variant="secondary" className="w-full">Send Magic Link</Button>
                  </div>
                </div>
              )}

            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation */}
        {step < 8 && (
          <div className="flex justify-between items-center mt-16 pt-6 border-t border-border">
            <Button variant="ghost" onClick={() => go(-1)} disabled={step === 1} className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 px-8"
              onClick={step === 7 ? handleSubmit : step === 1 ? handleStep1Continue : () => go(1)}
              disabled={!canNext || (step === 1 && captureLead.isPending)}
            >
              {step === 7 ? "Confirm Booking" : step === 1 && captureLead.isPending ? "Saving…" : "Continue"} <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Desktop Sidebar */}
      {step > 2 && step < 8 && (
        <div className="hidden md:block w-72 border-l border-border bg-card p-6 shrink-0">
          <div className="sticky top-24">
            <h3 className="text-base font-bold mb-4 border-b border-border pb-2">Order Summary</h3>
            <div className="space-y-3 mb-6 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Customer</p>
                <p className="font-medium">{state.customer.name}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Vehicle</p>
                <p className="font-medium capitalize">{state.vehicle.yearMakeModel} ({state.vehicle.type})</p>
              </div>
            </div>
            <div className="space-y-2 mb-4">
              {currentPricing?.lineItems?.map((item: any, i: number) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-muted-foreground truncate pr-2">{item.name}</span>
                  <span>{item.isQuoteBased ? "TBD" : `$${item.price?.toFixed(2)}`}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-border pt-3 space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>${currentPricing?.subtotal?.toFixed(2) ?? "0.00"}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">HST (15%)</span><span>${currentPricing?.tax?.toFixed(2) ?? "0.00"}</span></div>
              <div className="flex justify-between font-bold text-lg pt-1"><span>Total</span><span className="text-primary">${currentPricing?.total?.toFixed(2) ?? "0.00"}</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile sticky bar */}
      {step > 2 && step < 8 && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border p-4 z-50 flex justify-between items-center">
          <div>
            <p className="text-xs text-muted-foreground">Estimated Total</p>
            <p className="text-lg font-bold text-primary">${currentPricing?.total?.toFixed(2) ?? "0.00"}</p>
          </div>
          <Button className="bg-primary text-primary-foreground" onClick={step === 7 ? handleSubmit : () => go(1)} disabled={!canNext}>
            {step === 7 ? "Confirm" : "Next"} <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
