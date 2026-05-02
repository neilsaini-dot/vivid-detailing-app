import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Droplet, Sun, Shield, Settings,
  ChevronRight, ChevronLeft, ArrowLeft, ArrowRight, Plus, Check, CalendarIcon, Info, User, Phone, Clock
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
  useGetCalendarAvailability,
  PriceCalculateBodyVehicleType, CreateVehicleBodyType
} from "@workspace/api-client-react";

type VehicleType = "car" | "suv" | "truck" | "van";
type Intent = "clean" | "protect" | "tint" | "paint" | "quote";

interface BookingState {
  customer: { name: string; email: string; phone: string; };
  vehicle: { type: VehicleType; yearMakeModel: string; colour: string; };
  vehicleTypeSelected: boolean;
  intent?: Intent;
  selectedVlt: number;
  serviceIds: string[];
  addOnIds: string[];
  bundleAddonIds: string[];
  promoIds: string[];
  appointmentAt?: Date;
  timeSlot?: string;
  notes: string;
  depositPaid: boolean;
}

const initialState: BookingState = {
  customer: { name: "", email: "", phone: "" },
  vehicle: { type: "car", yearMakeModel: "", colour: "" },
  vehicleTypeSelected: false,
  selectedVlt: 35, serviceIds: [], addOnIds: [], bundleAddonIds: [], promoIds: [],
  notes: "", depositPaid: false,
};

const STEPS = 8;
const TIME_SLOTS = ["08:00", "10:00", "12:00", "14:00", "16:00"];

const VLT_LEVELS = [
  { vlt: 5,  label: "5% — Limo",       desc: ["Maximum privacy (\"Limo Tint\")", "Excellent heat rejection", "Hardest to see out of at night"] },
  { vlt: 15, label: "15% — Very Dark", desc: ["High privacy level", "Matches most factory rear window tints", "Great glare reduction"] },
  { vlt: 25, label: "25% — Dark",      desc: ["Popular choice for side windows", "Strong privacy and heat rejection", "Sleek, aggressive look"] },
  { vlt: 35, label: "35% — Medium",    desc: ["Good balance of privacy and visibility", "Elegant, understated finish", "Popular all-around choice"] },
  { vlt: 50, label: "50% — Light",     desc: ["Light tint, visible interior", "Excellent nighttime visibility", "Still provides UV and heat protection"] },
];
const VLT_OPACITY: Record<number, number> = { 5: 0.92, 15: 0.76, 25: 0.58, 35: 0.38, 50: 0.15 };

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

const SERVICE_SCOPE: Record<string, "interior" | "exterior" | "both"> = {
  "Vivid Interior":                    "interior",
  "Vivid Luster":                      "both",
  "Vivid Glow":                        "both",
  "Summer Special Ceramic Exterior":   "exterior",
  "Vivid Ceramic Gloss Pro":           "exterior",
  "Vivid Ceramic Guard":               "both",
  "Vivid Ceramic Elite Guard":         "both",
  "Vivid Ceramic Tint - Rear":         "exterior",
  "Vivid Ceramic Tint - Full":         "exterior",
  "Windshield Eyebrow Tint":           "exterior",
  "Paint Correction":                  "both",
};

const SMART_RECS: Record<string, string[]> = {
  "Vivid Interior":                  ["Ozone Treatment / Deodorizer"],
  "Vivid Luster":                    ["Paint Sealant", "Windshield Hydrophobic Coating"],
  "Vivid Glow":                      ["Vivid Ceramic Glass - Full Vehicle"],
  "Summer Special Ceramic Exterior": ["Windshield Ceramic", "Ceramic Rims"],
  "Vivid Ceramic Gloss Pro":         ["Windshield Ceramic", "Ceramic Rims"],
  "Vivid Ceramic Guard":             ["Vivid Ceramic Glass - Full Vehicle", "Vivid Interior Ceramic Leather", "Ceramic Rims"],
  "Vivid Ceramic Elite Guard":       ["Vivid Ceramic Glass - Full Vehicle", "Vivid Interior Ceramic Leather", "Ceramic Rims"],
  "Vivid Ceramic Tint - Full":       ["Windshield Eyebrow Tint", "Vivid Ceramic Glass - Full Vehicle"],
};

// ── Time estimates ──────────────────────────────────────────────
// Vehicle modifier applies per base service (SUV/Truck +1hr, Van +2hr)
const SERVICE_TIMES: Record<string, { min: number; max: number; custom?: boolean }> = {
  "Vivid Interior":                    { min: 4,  max: 6  },
  "Vivid Luster":                      { min: 5,  max: 6  },
  "Vivid Glow":                        { min: 6,  max: 7  },
  "Summer Special Ceramic Exterior":   { min: 7,  max: 7  },
  "Vivid Ceramic Gloss Pro":           { min: 7,  max: 7  },
  "Vivid Ceramic Guard":               { min: 24, max: 24 },
  "Vivid Ceramic Elite Guard":         { min: 36, max: 36 },
  "Vivid Ceramic Tint - Rear":         { min: 6,  max: 6  },
  "Vivid Ceramic Tint - Full":         { min: 8,  max: 8  },
  "Windshield Eyebrow Tint":           { min: 2,  max: 2  },
  "Paint Correction":                  { min: 4,  max: 24 },
  "PPF - Full Front":                  { min: 0,  max: 0,  custom: true },
};

const ADDON_TIMES: Record<string, { min: number; max: number }> = {
  "Pet Hair Removal":                   { min: 1, max: 2 },
  "Steam Cleaning Interior":            { min: 1, max: 1 },
  "Shampoo Upholstery":                 { min: 3, max: 3 },
  "Headliner Cleaning":                 { min: 1, max: 1 },
  "Ozone Treatment / Deodorizer":       { min: 2, max: 2 },
  "Child Seat Clean & Sanitize":        { min: 1, max: 1 },
  "Additional Mats":                    { min: 1, max: 1 },
  "Vivid Interior Ceramic Leather":     { min: 2, max: 2 },
  "Headlight Restoration":              { min: 2, max: 2 },
  "Engine Shampoo":                     { min: 1, max: 1 },
  "Ceramic Rims":                       { min: 1, max: 1 },
  "Paint Decontamination":              { min: 1, max: 1 },
  "Paint Sealant":                      { min: 1, max: 1 },
  "Minor Scratch/Blemish Correction":   { min: 1, max: 1 },
  "Windshield Hydrophobic Coating":     { min: 1, max: 1 },
  "Soft Top / Tonneau Cover Protection":{ min: 1, max: 1 },
  "Vivid Ceramic Glass - Full Vehicle": { min: 2, max: 2 },
  "Windshield Ceramic":                 { min: 1, max: 1 },
};

const ADDON_DISCLAIMERS: Record<string, string> = {
  "Shampoo Upholstery":              "Only needed for heavy staining. Vehicle must be left overnight.",
  "Ozone Treatment / Deodorizer":    "Vehicle must air out 2-3 hours after treatment before it can be occupied or driven.",
  "Engine Shampoo":                  "Engine must be fully cool before service begins. Hood access required.",
  "Headlight Restoration":           "Results may vary on severely cracked, pitted, or deeply scratched lenses.",
  "Minor Scratch/Blemish Correction":"Suitable for light surface scratches only. Deep chips, gouges, or panel damage cannot be fully corrected.",
  "Pet Hair Removal":                "Heavily embedded pet hair may require extra time. Final result depends on severity of buildup.",
};

function vehicleTimeMod(type: VehicleType): number {
  if (type === "suv" || type === "truck") return 1;
  if (type === "van") return 2;
  return 0;
}

function fmtTime(min: number, max: number, custom?: boolean): string {
  if (custom) return "Custom";
  const unit = (n: number) => `${n} hr${n !== 1 ? "s" : ""}`;
  if (min === max) return unit(min);
  return `${min}–${max} hrs`;
}

export default function BookingFlow() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [dir, setDir] = useState(1);
  const [state, setState] = useState<BookingState>(initialState);
  const [currentPricing, setCurrentPricing] = useState<any>(null);

  const [capturedLeadId, setCapturedLeadId] = useState<string | null>(null);
  const [touched, setTouched] = useState({ name: false, phone: false, yearMakeModel: false, email: false });
  const [totalFlash, setTotalFlash] = useState(false);

  const [tintSubStep, setTintSubStep] = useState(false);
  const [tintSplitPos, setTintSplitPos] = useState(50);
  const [tintDragging, setTintDragging] = useState(false);
  const tintContainerRef = useRef<HTMLDivElement>(null);

  const updateTintSplit = useCallback((clientX: number) => {
    if (!tintContainerRef.current) return;
    const rect = tintContainerRef.current.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setTintSplitPos(Math.min(95, Math.max(5, pct)));
  }, []);

  const onTintMouseMove = useCallback((e: React.MouseEvent) => {
    if (!tintDragging) return;
    updateTintSplit(e.clientX);
  }, [tintDragging, updateTintSplit]);

  const onTintTouchMove = useCallback((e: React.TouchEvent) => {
    updateTintSplit(e.touches[0].clientX);
  }, [updateTintSplit]);

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
    if (vltParam) {
      const parsed = parseInt(vltParam, 10);
      if ([5, 15, 25, 35, 50].includes(parsed)) {
        setState(s => ({ ...s, selectedVlt: parsed }));
      }
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

  // Flash effect when total changes
  useEffect(() => {
    if (currentPricing?.total) {
      setTotalFlash(true);
      const t = setTimeout(() => setTotalFlash(false), 700);
      return () => clearTimeout(t);
    }
  }, [currentPricing?.total]);

  // Derived: service scope determines which add-on groups to display
  const selectedServiceNames = (services as any[])
    .filter(s => state.serviceIds.includes(s.id))
    .map(s => s.name as string);
  const serviceScopes = selectedServiceNames.map(n => SERVICE_SCOPE[n] ?? "both");
  const showInteriorAddons = serviceScopes.length === 0 || serviceScopes.some(s => s === "interior" || s === "both");
  const showExteriorAddons = serviceScopes.length === 0 || serviceScopes.some(s => s === "exterior" || s === "both");

  // Protection add-ons shown in step 3 for the "protect" goal
  const protectionStepAddons = (addOns as any[]).filter(a => a.showInProtectionStep);

  // ── Running time estimate ──────────────────────────────────────
  const vMod = vehicleTimeMod(state.vehicle.type);
  const selSvcs = (services as any[]).filter(s => state.serviceIds.includes(s.id));
  const selAddons = (addOns as any[]).filter(a => state.addOnIds.includes(a.id));
  const bundleDiscount = selAddons
    .filter(a => state.bundleAddonIds.includes(a.id))
    .reduce((sum, a) => {
      const p = a.prices.find((pr: any) => pr.vehicleType === state.vehicle.type)?.price ?? 0;
      return sum + Math.round(p * 0.25 * 100) / 100;
    }, 0);
  const adjustedTotal = Math.max(0, ((currentPricing?.total ?? 0) - bundleDiscount * 1.15));
  const hasCustomTime = selSvcs.some(s => SERVICE_TIMES[s.name]?.custom);
  let runTimeMin = 0, runTimeMax = 0;
  if (!hasCustomTime) {
    for (const s of selSvcs) {
      const t = SERVICE_TIMES[s.name];
      if (t && !t.custom) { runTimeMin += t.min + vMod; runTimeMax += t.max + vMod; }
    }
  }
  for (const a of selAddons) {
    const t = ADDON_TIMES[a.name];
    if (t) { runTimeMin += t.min; runTimeMax += t.max; }
  }
  const timeEstimate = hasCustomTime
    ? "Custom"
    : (selSvcs.length > 0 || selAddons.length > 0)
      ? fmtTime(runTimeMin, runTimeMax)
      : null;

  // Calendar availability — fetched once we're on step 7 with a date selected
  // Duration defaults to max service time, or 4 hrs for custom/quote services
  const selectedDateStr = state.appointmentAt
    ? `${state.appointmentAt.getFullYear()}-${String(state.appointmentAt.getMonth() + 1).padStart(2, "0")}-${String(state.appointmentAt.getDate()).padStart(2, "0")}`
    : undefined;
  const calDuration = hasCustomTime ? 4 : Math.max(runTimeMax || 2, 0.25);
  const { data: calData, isFetching: calFetching } = useGetCalendarAvailability(
    { date: selectedDateStr!, duration: calDuration },
    { query: { enabled: step === 7 && !!selectedDateStr } }
  );


  const go = (delta: number) => { setDir(delta); setStep(s => Math.min(Math.max(s + delta, 1), STEPS)); };

  const isValidPhone = (p: string) => p.replace(/\D/g, "").length === 10;
  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

  const formatPhone = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const handleStep1Continue = async () => {
    setTouched({ name: true, phone: true, yearMakeModel: true });
    if (!state.customer.name || !isValidPhone(state.customer.phone) || !state.vehicleTypeSelected || !state.vehicle.yearMakeModel) return;
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
  const toggleAddon = (id: string) => setState(s => ({
    ...s,
    addOnIds: s.addOnIds.includes(id) ? s.addOnIds.filter(x => x !== id) : [...s.addOnIds, id],
    bundleAddonIds: s.addOnIds.includes(id) ? s.bundleAddonIds.filter(x => x !== id) : s.bundleAddonIds,
  }));
  const toggleBundleAddon = (id: string) => setState(s => {
    const adding = !s.addOnIds.includes(id);
    return {
      ...s,
      addOnIds: adding ? [...s.addOnIds, id] : s.addOnIds.filter(x => x !== id),
      bundleAddonIds: adding ? [...s.bundleAddonIds, id] : s.bundleAddonIds.filter(x => x !== id),
    };
  });

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
          bundleAddonIds: state.bundleAddonIds.length > 0 ? state.bundleAddonIds : undefined,
          bundleDiscount: bundleDiscount > 0 ? bundleDiscount : undefined,
          appointmentAt: dt?.toISOString(),
          notes: state.intent === "tint"
            ? `VLT: ${state.selectedVlt}%${state.notes ? ` | ${state.notes}` : ""}`
            : state.notes,
          totalEstimate: adjustedTotal,
        }
      });
      toast({ title: "Booking Confirmed", description: "Your appointment has been scheduled." });
      go(1);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to create booking. Please try again." });
    }
  };

  const handleBack = () => {
    if (tintSubStep) {
      setTintSubStep(false);
    } else if (step === 3 && state.intent === "tint") {
      setDir(-1);
      setTintSubStep(true);
    } else {
      go(-1);
    }
  };

  const canNext =
    (step === 1 && !!state.customer.name && isValidPhone(state.customer.phone) && state.vehicleTypeSelected && !!state.vehicle.yearMakeModel) ||
    (step === 2 && !!state.intent) ||
    (step === 3 && (state.serviceIds.length > 0 || (state.intent === "protect" && state.addOnIds.length > 0))) ||
    (step === 4) ||
    (step === 5) ||
    (step === 6) ||
    (step === 7 && !!state.appointmentAt && !!state.timeSlot && isValidEmail(state.customer.email));

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background flex flex-col md:flex-row">
      <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full px-4 py-8 relative">
        <div className="mb-8">
          <Progress value={(step / STEPS) * 100} className="h-1.5" />
          <p className="text-sm text-muted-foreground mt-2 font-medium">
            {tintSubStep ? "Step 2 of 8 — Tint Preview" : `Step ${step} of ${STEPS}`}
          </p>
        </div>

        <div className="overflow-x-hidden">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ x: { type: "spring", stiffness: 300, damping: 30 }, opacity: { duration: 0.15 } }}
              className={`w-full ${step > 2 && step < 8 ? "pb-28 md:pb-0" : "pb-8"}`}
            >

              {/* ── Step 1: Name + Phone + Vehicle ── */}
              {step === 1 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Let's get started</h2>
                    <p className="text-muted-foreground">Your info and vehicle. Takes under a minute.</p>
                  </div>

                  {/* Name + Phone */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Your Name</Label>
                      <div className="relative">
                        <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="name"
                          className={`pl-9 ${touched.name && !state.customer.name ? "border-destructive focus-visible:ring-destructive" : ""}`}
                          placeholder="Jane Smith"
                          value={state.customer.name}
                          onChange={e => updateCustomer({ name: e.target.value })}
                          onBlur={() => setTouched(t => ({ ...t, name: true }))}
                          autoFocus
                        />
                      </div>
                      {touched.name && !state.customer.name && (
                        <p className="text-xs text-destructive">Please enter your name</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone Number</Label>
                      <div className="relative">
                        <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="phone"
                          type="tel"
                          className={`pl-9 ${touched.phone && !isValidPhone(state.customer.phone) ? "border-destructive focus-visible:ring-destructive" : ""}`}
                          placeholder="902-555-1234"
                          value={state.customer.phone}
                          onChange={e => updateCustomer({ phone: formatPhone(e.target.value) })}
                          onBlur={() => setTouched(t => ({ ...t, phone: true }))}
                        />
                      </div>
                      {touched.phone && !isValidPhone(state.customer.phone) && (
                        <p className="text-xs text-destructive">
                          {state.customer.phone ? "Please enter a valid 10-digit phone number" : "Please enter your phone number"}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Vehicle type */}
                  <div>
                    <Label className="mb-3 block">Vehicle Type</Label>
                    <div className="grid grid-cols-2 gap-3">

                      {([
                        { type: "car" as VehicleType, label: "Car / Sedan", img: "/vehicle-sedan.png" },
                        { type: "suv" as VehicleType, label: "SUV / Crossover", img: "/vehicle-suv.png" },
                        { type: "truck" as VehicleType, label: "Pickup Truck", img: "/vehicle-truck.png" },
                        { type: "van" as VehicleType, label: "Van / Minivan", img: "/vehicle-van.png" },
                      ]).map(({ type: t, label, img }) => (
                        <Card
                          key={t}
                          className={`cursor-pointer transition-all ${state.vehicleTypeSelected && state.vehicle.type === t ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50"}`}
                          onClick={() => { updateVehicle({ type: t }); setState(s => ({ ...s, vehicleTypeSelected: true })); }}
                        >
                          <CardContent className="flex flex-col items-center justify-center p-3 gap-2">
                            <img
                              src={img}
                              alt={label}
                              className={`w-full h-24 object-contain transition-all ${state.vehicleTypeSelected && state.vehicle.type === t ? "opacity-100" : "opacity-60"}`}
                            />
                            <span className={`font-semibold text-xs text-center ${state.vehicleTypeSelected && state.vehicle.type === t ? "text-primary" : "text-muted-foreground"}`}>{label}</span>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    {touched.name && !state.vehicleTypeSelected && (
                      <p className="text-xs text-destructive mt-2">Please select your vehicle type</p>
                    )}
                  </div>

                  {/* Year / Make / Model + Colour */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Year, Make & Model</Label>
                      <Input
                        className={touched.yearMakeModel && !state.vehicle.yearMakeModel ? "border-destructive focus-visible:ring-destructive" : ""}
                        placeholder="e.g. 2023 Honda Civic"
                        value={state.vehicle.yearMakeModel}
                        onChange={e => updateVehicle({ yearMakeModel: e.target.value })}
                        onBlur={() => setTouched(t => ({ ...t, yearMakeModel: true }))}
                      />
                      {touched.yearMakeModel && !state.vehicle.yearMakeModel && (
                        <p className="text-xs text-destructive">Please enter your vehicle details</p>
                      )}
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
                        onClick={() => { setState(s => ({ ...s, intent: intent.id as Intent })); if (intent.id !== "tint") setTintSubStep(false); }}
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

              {/* ── Tint Sub-step: VLT Visualizer ── */}
              {step === 2 && tintSubStep && state.intent === "tint" && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Preview Your Tint</h2>
                    <p className="text-muted-foreground text-sm">
                      Drag the divider to compare tinted vs. clear glass. Pick your preferred darkness, then continue to see pricing.
                    </p>
                  </div>

                  {/* Before / After Reveal */}
                  <div
                    ref={tintContainerRef}
                    className="relative aspect-video rounded-xl border border-border overflow-hidden bg-black shadow-xl shadow-black/50 select-none"
                    style={{ cursor: tintDragging ? "col-resize" : "ew-resize" }}
                    onMouseMove={onTintMouseMove}
                    onMouseUp={() => setTintDragging(false)}
                    onMouseLeave={() => setTintDragging(false)}
                    onTouchMove={onTintTouchMove}
                    onTouchEnd={() => setTintDragging(false)}
                  >
                    <div className="absolute inset-0">
                      <img src="/tint-car.png" alt="Clear windows" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
                    </div>
                    <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${tintSplitPos}%)` }}>
                      <img src="/tint-car.png" alt="Tinted windows" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
                      <div className="absolute inset-0 pointer-events-none" style={{ background: "rgb(6,10,18)", mixBlendMode: "multiply", opacity: VLT_OPACITY[state.selectedVlt] ?? 0.38, transition: "opacity 0.3s ease" }} />
                    </div>
                    <div className="absolute top-0 bottom-0 w-0.5 bg-white/90 shadow-[0_0_10px_rgba(255,255,255,0.7)]" style={{ left: `${tintSplitPos}%` }} />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 flex items-center justify-center w-10 h-10 rounded-full bg-white shadow-lg cursor-col-resize"
                      style={{ left: `${tintSplitPos}%` }}
                      onMouseDown={e => { e.preventDefault(); setTintDragging(true); }}
                      onTouchStart={e => { e.preventDefault(); setTintDragging(true); }}
                    >
                      <ChevronLeft size={14} className="text-gray-700 -mr-0.5" />
                      <ChevronRight size={14} className="text-gray-700 -ml-0.5" />
                    </div>
                    <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-bold text-white tracking-widest pointer-events-none" style={{ opacity: tintSplitPos > 15 ? 1 : 0 }}>BEFORE</div>
                    <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-bold text-white tracking-widest pointer-events-none" style={{ opacity: tintSplitPos < 85 ? 1 : 0 }}>{state.selectedVlt}% VLT</div>
                    <div className="absolute bottom-3 right-3 opacity-50 pointer-events-none">
                      <img src="/logo.png" alt="Vivid Detailing" className="h-7 w-7 object-contain" />
                    </div>
                  </div>

                  {/* VLT selector */}
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    {VLT_LEVELS.map(l => (
                      <button
                        key={l.vlt}
                        onClick={() => setState(s => ({ ...s, selectedVlt: l.vlt }))}
                        className={`flex flex-col items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
                          state.selectedVlt === l.vlt
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        }`}
                      >
                        <span className="w-8 h-5 rounded border border-white/10" style={{ background: `rgba(8,12,20,${VLT_OPACITY[l.vlt]})` }} />
                        {l.vlt}%
                      </button>
                    ))}
                  </div>

                  {/* Description of selected level */}
                  {(() => {
                    const lvl = VLT_LEVELS.find(l => l.vlt === state.selectedVlt) ?? VLT_LEVELS[3];
                    return (
                      <div className="rounded-lg bg-card border border-border p-4 space-y-2">
                        <p className="font-semibold text-sm">{lvl.label}</p>
                        {lvl.desc.map(d => (
                          <div key={d} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <span className="text-primary mt-0.5">•</span>
                            <span>{d}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── Step 3: Services ── */}
              {step === 3 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Recommended Services</h2>
                    <p className="text-muted-foreground">Select one or more services below.</p>
                  </div>

                  {state.intent === "tint" && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="w-8 h-6 rounded border border-white/10 shrink-0"
                          style={{ background: `rgba(8,12,20,${VLT_OPACITY[state.selectedVlt] ?? 0.38})` }}
                        />
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            Your selection: {state.selectedVlt}% VLT — {VLT_LEVELS.find(l => l.vlt === state.selectedVlt)?.label.split("—")[1]?.trim()}
                          </p>
                          <p className="text-xs text-muted-foreground">This will be noted on your booking</p>
                        </div>
                      </div>
                      <button
                        className="text-xs text-primary font-semibold hover:underline shrink-0"
                        onClick={() => { setDir(-1); setTintSubStep(true); setStep(2); }}
                      >
                        Change
                      </button>
                    </div>
                  )}

                  <div className="grid gap-4">
                    {(services as any[]).map((svc: any) => {
                      const selected = state.serviceIds.includes(svc.id);
                      const price = svc.prices.find((p: any) => p.vehicleType === state.vehicle.type)?.price ?? svc.basePrice;
                      return (
                        <Card
                          key={svc.id}
                          className={`transition-all cursor-pointer relative overflow-hidden ${selected ? "border-primary bg-primary/5 ring-1 ring-primary/50" : "hover:border-primary/40"} ${svc.isSeasonal ? "border-primary/60" : ""}`}
                          onClick={() => toggleService(svc.id)}
                        >
                          {svc.isSeasonal && (
                            <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-[10px] font-bold px-2.5 py-1 rounded-bl-lg tracking-wide">
                              SUMMER SPECIAL
                            </div>
                          )}
                          {!svc.isSeasonal && state.intent === "tint" && (
                            <div className="absolute top-0 right-0 flex items-center gap-1.5 bg-card border-l border-b border-border text-[10px] font-bold px-2.5 py-1 rounded-bl-lg tracking-wide text-muted-foreground">
                              <span
                                className="w-4 h-3 rounded-sm border border-white/10 inline-block"
                                style={{ background: `rgba(8,12,20,${VLT_OPACITY[state.selectedVlt] ?? 0.38})` }}
                              />
                              {state.selectedVlt}% VLT
                            </div>
                          )}
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
                                {svc.pricingRule === "quote_based" ? (
                                  <span className="font-bold text-primary text-base">Quote</span>
                                ) : (
                                  <span className="font-bold text-primary text-lg">${price ?? "-"}</span>
                                )}
                                {(() => {
                                  const t = SERVICE_TIMES[svc.name];
                                  const svcMin = t && !t.custom ? t.min + vMod : t?.min ?? 0;
                                  const svcMax = t && !t.custom ? t.max + vMod : t?.max ?? 0;
                                  return t ? (
                                    <div className="flex items-center justify-end gap-1 mt-1 text-muted-foreground text-xs">
                                      <Clock size={10} />
                                      <span>{fmtTime(svcMin, svcMax, t.custom)}</span>
                                    </div>
                                  ) : null;
                                })()}
                                {selected
                                  ? <div className="mt-1.5 flex items-center justify-end gap-1 text-primary text-xs font-semibold"><Check size={12} />Selected</div>
                                  : <div className="mt-1.5 text-xs text-muted-foreground">Tap to select</div>
                                }
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                    {(services as any[]).length === 0 && (
                      <p className="text-center text-muted-foreground py-12">No services found. Please go back and select a goal.</p>
                    )}
                  </div>

                  {state.intent === "protect" && protectionStepAddons.length > 0 && (
                    <div className="mt-2">
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 border-b border-border pb-2">
                        Individual Protection Add-ons
                      </h3>
                      <div className="grid gap-3">
                        {protectionStepAddons.map((addon: any) => {
                          const selected = state.addOnIds.includes(addon.id);
                          const price = addon.prices.find((p: any) => p.vehicleType === state.vehicle.type)?.price ?? addon.prices[0]?.price;
                          return (
                            <Card
                              key={addon.id}
                              className={`transition-all cursor-pointer ${selected ? "border-primary bg-primary/5 ring-1 ring-primary/50" : "hover:border-primary/40"}`}
                              onClick={() => toggleAddon(addon.id)}
                            >
                              <CardContent className="flex justify-between items-center p-4">
                                <div className="flex items-center gap-3">
                                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${selected ? "bg-primary border-primary" : "border-muted-foreground"}`}>
                                    {selected && <Check size={10} className="text-primary-foreground" />}
                                  </div>
                                  <div>
                                    <span className="font-medium text-sm">{addon.name}</span>
                                    {ADDON_TIMES[addon.name] && (
                                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                                        <Clock size={9} />{fmtTime(ADDON_TIMES[addon.name].min, ADDON_TIMES[addon.name].max)}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <span className="font-bold text-primary text-sm">${price ?? "-"}</span>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Step 4: Add-ons ── */}
              {step === 4 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Optional Add-ons</h2>
                    <p className="text-muted-foreground text-sm">Extras to round out your service. All optional.</p>
                  </div>
                  <div className="space-y-5">
                    {[
                      { key: "Interior Upgrades", show: showInteriorAddons },
                      { key: "Exterior Upgrades", show: showExteriorAddons },
                    ].map(({ key, show }) => {
                      if (!show) return null;
                      const grouped = (addOns as any[]).filter(a => a.categoryGroup === key);
                      if (!grouped.length) return null;
                      return (
                        <div key={key}>
                          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2 border-b border-border/50 pb-1.5">{key}</h3>
                          <div className="divide-y divide-border/40">
                            {grouped.map((addon: any) => {
                              const price = addon.prices.find((p: any) => p.vehicleType === state.vehicle.type)?.price ?? 0;
                              const checked = state.addOnIds.includes(addon.id);
                              return (
                                <label
                                  key={addon.id}
                                  className={`flex items-center justify-between py-2.5 px-1 cursor-pointer rounded transition-colors ${checked ? "text-primary" : "hover:bg-accent/40"}`}
                                >
                                  <div className="flex items-center gap-3">
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={() => toggleAddon(addon.id)}
                                      className="h-4 w-4"
                                    />
                                    <div>
                                      <span className={`text-sm leading-tight block ${checked ? "font-medium text-primary" : "text-foreground"}`}>{addon.name}</span>
                                      {ADDON_TIMES[addon.name] && (
                                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                                          <Clock size={9} />{fmtTime(ADDON_TIMES[addon.name].min, ADDON_TIMES[addon.name].max)}
                                        </span>
                                      )}
                                      {ADDON_DISCLAIMERS[addon.name] && (
                                        <span className="block text-[10px] text-amber-500/90 mt-0.5 leading-tight">
                                          ⚠ {ADDON_DISCLAIMERS[addon.name]}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <span className={`text-xs font-semibold shrink-0 ml-4 ${checked ? "text-primary" : "text-muted-foreground"}`}>
                                    +${price}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {(addOns as any[]).length === 0 && <p className="text-muted-foreground text-center py-8 text-sm">No add-ons available.</p>}
                  </div>
                </div>
              )}

              {/* ── Step 5: Bundle Offer ── */}
              {step === 5 && (() => {
                const recNames = new Set(selectedServiceNames.flatMap(n => SMART_RECS[n] ?? []));
                const recAddons = (addOns as any[]).filter(a => recNames.has(a.name));
                const anyAdded = recAddons.some((a: any) => state.addOnIds.includes(a.id));
                const stepSavings = recAddons
                  .filter((a: any) => state.addOnIds.includes(a.id))
                  .reduce((sum: number, a: any) => {
                    const p = a.prices.find((pr: any) => pr.vehicleType === state.vehicle.type)?.price ?? 0;
                    return sum + Math.round(p * 0.25 * 100) / 100;
                  }, 0);
                return (
                  <div className="space-y-5">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h2 className="text-3xl font-bold">Exclusive Bundle Offer</h2>
                        <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-xs px-2 py-0.5 font-bold">25% OFF</Badge>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {recAddons.length > 0
                          ? "Add any of these to your booking today and save 25% off the regular price. This deal is only available at time of booking."
                          : "Your selection looks complete. No additional add-ons to bundle."}
                      </p>
                    </div>

                    {recAddons.length > 0 && (
                      <>
                        <div className="grid gap-3">
                          {recAddons.map((addon: any) => {
                            const added = state.addOnIds.includes(addon.id);
                            const fullPrice = addon.prices.find((p: any) => p.vehicleType === state.vehicle.type)?.price ?? 0;
                            const discPrice = Math.round(fullPrice * 0.75 * 100) / 100;
                            const savings = fullPrice - discPrice;
                            return (
                              <Card
                                key={addon.id}
                                className={`transition-all border ${added ? "border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/20" : "border-border hover:border-emerald-500/30"}`}
                              >
                                <CardContent className="p-4 flex justify-between items-center gap-4">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-semibold text-sm">{addon.name}</span>
                                      {added && (
                                        <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-[10px] px-1.5 py-0">
                                          Saving ${savings.toFixed(0)}
                                        </Badge>
                                      )}
                                    </div>
                                    {ADDON_DISCLAIMERS[addon.name] && (
                                      <p className="text-[10px] text-amber-500/90 mt-1 leading-tight">
                                        ⚠ {ADDON_DISCLAIMERS[addon.name]}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0">
                                    <div className="text-right">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-xs text-muted-foreground line-through">${fullPrice}</span>
                                        <span className="font-bold text-emerald-400 text-sm">+${discPrice.toFixed(0)}</span>
                                      </div>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant={added ? "default" : "outline"}
                                      className={`h-8 px-4 text-xs font-semibold min-w-[72px] ${added ? "bg-emerald-600 text-white hover:bg-emerald-700 border-0" : "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-400"}`}
                                      onClick={() => toggleBundleAddon(addon.id)}
                                    >
                                      {added ? "✓ Added" : "Add"}
                                    </Button>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>

                        {anyAdded && (
                          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 flex items-center justify-between">
                            <span className="text-sm text-emerald-400 font-medium">Bundle savings</span>
                            <span className="text-sm font-bold text-emerald-400">−${stepSavings.toFixed(2)}</span>
                          </div>
                        )}
                      </>
                    )}

                    {/* No thanks / continue section */}
                    <div className="border-t border-border/50 pt-4 flex flex-col items-center gap-3">
                      <Button
                        size="lg"
                        className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
                        onClick={() => go(1)}
                      >
                        {anyAdded ? "Continue to Review" : "Continue"}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                      {anyAdded && (
                        <button
                          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                          onClick={() => {
                            const recIds = recAddons.map((a: any) => a.id);
                            setState(s => ({
                              ...s,
                              addOnIds: s.addOnIds.filter(id => !recIds.includes(id)),
                              bundleAddonIds: s.bundleAddonIds.filter(id => !recIds.includes(id)),
                            }));
                            go(1);
                          }}
                        >
                          No thanks, skip all
                        </button>
                      )}
                      {!anyAdded && (
                        <button
                          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                          onClick={() => go(1)}
                        >
                          No thanks, continue without adding
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}

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
                        {bundleDiscount > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-emerald-400 flex items-center gap-1">
                              <span>Bundle Deal (25% off)</span>
                              <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-[10px] px-1.5 py-0">SAVED</Badge>
                            </span>
                            <span className="text-emerald-400 font-medium">−${bundleDiscount.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">HST (15%)</span>
                          <span>${(Math.max(0, (currentPricing?.subtotal ?? 0) - bundleDiscount) * 0.15).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-xl pt-2 border-t border-border mt-2">
                          <span>Total</span>
                          <span className="text-primary">${adjustedTotal.toFixed(2)}</span>
                        </div>
                        {bundleDiscount > 0 && (
                          <p className="text-xs text-emerald-400 text-right">
                            You saved ${(bundleDiscount * 1.15).toFixed(2)} with the bundle deal!
                          </p>
                        )}
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
                          onSelect={d => setState(s => ({ ...s, appointmentAt: d, timeSlot: undefined }))}
                          disabled={date => {
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            return date < today;
                          }}
                          className="rounded-md"
                        />
                      </Card>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Available Time Slots</Label>
                          {timeEstimate && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Clock size={10} />{timeEstimate} est.
                            </span>
                          )}
                        </div>
                        {!state.appointmentAt ? (
                          <p className="text-sm text-muted-foreground py-4 text-center">Select a date to see available slots.</p>
                        ) : calFetching ? (
                          <div className="grid grid-cols-2 gap-2 pt-1">
                            {[...Array(6)].map((_, i) => (
                              <div key={i} className="h-10 rounded-md bg-accent animate-pulse" />
                            ))}
                          </div>
                        ) : calData?.slots && calData.slots.length > 0 ? (
                          <div className="grid grid-cols-2 gap-2 pt-1">
                            {calData.slots.map(slot => {
                              const isSelected = state.timeSlot === slot.start;
                              return (
                                <button
                                  key={slot.start}
                                  type="button"
                                  disabled={!slot.available}
                                  onClick={() => setState(s => ({ ...s, timeSlot: slot.start }))}
                                  className={`relative h-10 rounded-md border text-sm font-medium transition-all
                                    ${!slot.available
                                      ? "border-border/30 text-muted-foreground/30 cursor-not-allowed line-through bg-transparent"
                                      : isSelected
                                        ? "border-primary bg-primary text-primary-foreground shadow-[0_0_8px_rgba(41,184,217,0.4)]"
                                        : "border-border hover:border-primary/60 hover:bg-primary/5 text-foreground"
                                    }`}
                                >
                                  {slot.label}
                                  {!slot.available && (
                                    <span className="absolute inset-0 flex items-center justify-center text-[9px] text-muted-foreground/40 mt-4">booked</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground py-4 text-center">No available slots for this date.</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input
                          type="email"
                          placeholder="jane@example.com"
                          className={touched.email && !isValidEmail(state.customer.email) ? "border-destructive focus-visible:ring-destructive" : ""}
                          value={state.customer.email}
                          onChange={e => updateCustomer({ email: e.target.value })}
                          onBlur={() => setTouched(t => ({ ...t, email: true }))}
                        />
                        {touched.email && !isValidEmail(state.customer.email) && (
                          <p className="text-xs text-destructive">
                            {state.customer.email ? "Please enter a valid email address" : "Please enter your email address"}
                          </p>
                        )}
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
          <div className="flex justify-between items-center mt-6 pt-6 border-t border-border">
            <Button variant="ghost" onClick={handleBack} disabled={step === 1 && !tintSubStep} className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 px-8"
              onClick={
                step === 7 ? handleSubmit :
                step === 1 ? handleStep1Continue :
                step === 2 && state.intent === "tint" && !tintSubStep ? () => setTintSubStep(true) :
                step === 2 && tintSubStep ? () => { setTintSubStep(false); go(1); } :
                () => go(1)
              }
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
            <div className={`border-t pt-3 space-y-1.5 transition-colors duration-300 ${totalFlash ? "border-primary/50" : "border-border"}`}>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>${currentPricing?.subtotal?.toFixed(2) ?? "0.00"}</span></div>
              {bundleDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-400">Bundle Deal (25% off)</span>
                  <span className="text-emerald-400">−${bundleDiscount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">HST (15%)</span><span>${(Math.max(0, (currentPricing?.subtotal ?? 0) - bundleDiscount) * 0.15).toFixed(2)}</span></div>
              <div className="flex justify-between font-bold text-lg pt-1 items-center">
                <span>Total</span>
                <AnimatePresence mode="popLayout">
                  <motion.span
                    key={adjustedTotal}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ type: "spring", stiffness: 500, damping: 28 }}
                    className={`text-primary tabular-nums transition-colors duration-300 ${totalFlash ? "drop-shadow-[0_0_8px_rgba(41,184,217,0.6)]" : ""}`}
                  >
                    ${adjustedTotal.toFixed(2)}
                  </motion.span>
                </AnimatePresence>
              </div>
              {step >= 3 && step <= 5 && (state.serviceIds.length > 0 || state.addOnIds.length > 0) && (
                <p className="text-[10px] text-muted-foreground pt-0.5">
                  {[
                    state.serviceIds.length > 0 ? `${state.serviceIds.length} service${state.serviceIds.length !== 1 ? "s" : ""}` : null,
                    state.addOnIds.length > 0 ? `${state.addOnIds.length} add-on${state.addOnIds.length !== 1 ? "s" : ""}` : null,
                  ].filter(Boolean).join(" · ")} selected
                </p>
              )}
              {timeEstimate && (
                <div className={`flex items-center gap-1.5 pt-2 mt-1 border-t text-sm transition-colors duration-300 ${totalFlash ? "border-primary/30 text-primary" : "border-border/50 text-muted-foreground"}`}>
                  <Clock size={13} className="shrink-0" />
                  <AnimatePresence mode="popLayout">
                    <motion.span
                      key={timeEstimate}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="font-medium tabular-nums"
                    >
                      {timeEstimate}
                    </motion.span>
                  </AnimatePresence>
                  <span className="text-xs text-muted-foreground">est. time</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile sticky bar */}
      {step > 2 && step < 8 && (
        <div className={`md:hidden fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-sm border-t z-50 transition-colors duration-300 ${totalFlash && step >= 3 && step <= 5 ? "border-primary/60" : "border-border"}`}>
          <div className="flex justify-between items-center p-4 gap-4">
            <div className="min-w-0">
              {step >= 3 && step <= 5 && (state.serviceIds.length > 0 || state.addOnIds.length > 0) ? (
                <>
                  <p className="text-[11px] text-muted-foreground leading-tight truncate">
                    {[
                      state.serviceIds.length > 0 ? `${state.serviceIds.length} service${state.serviceIds.length !== 1 ? "s" : ""}` : null,
                      state.addOnIds.length > 0 ? `${state.addOnIds.length} add-on${state.addOnIds.length !== 1 ? "s" : ""}` : null,
                    ].filter(Boolean).join(" · ")}
                  </p>
                  <div className="flex items-baseline gap-1.5">
                    <AnimatePresence mode="popLayout">
                      <motion.span
                        key={adjustedTotal}
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        className="text-xl font-bold text-primary tabular-nums"
                      >
                        ${adjustedTotal.toFixed(2)}
                      </motion.span>
                    </AnimatePresence>
                    <span className="text-[10px] text-muted-foreground">incl. HST</span>
                  </div>
                  {timeEstimate && (
                    <AnimatePresence mode="popLayout">
                      <motion.div
                        key={timeEstimate}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5"
                      >
                        <Clock size={9} /><span>{timeEstimate}</span>
                      </motion.div>
                    </AnimatePresence>
                  )}
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">Estimated Total</p>
                  <p className="text-lg font-bold text-primary">${adjustedTotal.toFixed(2)}</p>
                </>
              )}
            </div>
            <Button
              className="bg-primary text-primary-foreground shrink-0"
              onClick={
                step === 7 ? handleSubmit :
                step === 2 && state.intent === "tint" && !tintSubStep ? () => setTintSubStep(true) :
                step === 2 && tintSubStep ? () => { setTintSubStep(false); go(1); } :
                () => go(1)
              }
              disabled={!canNext}
            >
              {step === 7 ? "Confirm" : tintSubStep ? "Continue to Pricing" : "Next"} <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
