import { useState, useRef, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  X, ChevronLeft, ChevronRight, RefreshCw, Camera, Upload,
  Trash2, CheckCircle2, AlertTriangle, Printer,
} from "lucide-react";

interface DamageEntry {
  id: string;
  zone: string;
  zoneName: string;
  type: string;
  severity: string;
  notes: string;
}

const VEHICLE_ZONES = [
  { id: "A", label: "Front bumper left" },
  { id: "B", label: "Front bumper right" },
  { id: "C", label: "Hood left" },
  { id: "D", label: "Hood right" },
  { id: "E", label: "Roof left" },
  { id: "F", label: "Roof right" },
  { id: "G", label: "Trunk left" },
  { id: "H", label: "Trunk right" },
  { id: "I", label: "Rear bumper left" },
  { id: "J", label: "Rear bumper right" },
  { id: "K", label: "Driver front door / quarter panel" },
  { id: "L", label: "Driver rear door / quarter panel" },
  { id: "M", label: "Passenger front door / quarter panel" },
  { id: "N", label: "Passenger rear door / quarter panel" },
  { id: "O", label: "Undercarriage / other" },
];

const DASHBOARD_LIGHTS = [
  "Engine / Check Engine",
  "Oil Pressure",
  "Battery",
  "Tire Pressure (TPMS)",
  "ABS",
  "Airbag / SRS",
  "Transmission",
  "Service Due",
  "Other",
];

const DAMAGE_TYPES = ["Scratch", "Dent", "Chip", "Crack", "Other"];
const SEVERITIES = ["Minor", "Moderate", "Significant"];

const DISCLAIMER =
  "By signing below, I confirm that the vehicle condition described in this inspection accurately reflects the state of my vehicle at the time of drop-off. I authorize Vivid Detailing to perform the services selected above.\n\nI understand and agree that:\n\nVivid Detailing is not responsible for pre-existing damage, wear, or defects not noted at the time of inspection, including but not limited to paint chips, scratches, dents, or mechanical issues.\n\nVivid Detailing is not responsible for damage caused by loose or broken trim, badges, seals, or mouldings that may be dislodged during the cleaning process.\n\nVivid Detailing is not responsible for damage resulting from pre-existing window tint, aftermarket accessories, or non-factory installations.\n\nVehicles left on premises after the agreed pickup time are left at the owner's risk. Vivid Detailing is not responsible for damage caused by weather events, including hail, wind, or flooding, while the vehicle is on our property or in our parking lot.\n\nInterior steam cleaning and moisture-based services may cause temporary condensation or moisture within the vehicle. Vivid Detailing is not responsible for damage to electronics, sensitive materials, or personal items left in the vehicle during service.\n\nPersonal items left in the vehicle are the owner's responsibility. Vivid Detailing is not responsible for lost, stolen, or damaged personal belongings.\n\nPayment is due upon pickup. Vivid Detailing reserves the right to hold the vehicle until full payment is received.";

const STEP_TITLES = ["Customer & Vehicle", "Vehicle Condition", "Job Details", "Before Photos", "Sign Off"];

function VehicleDiagram({
  damageEntries,
  onZoneClick,
}: {
  damageEntries: DamageEntry[];
  onZoneClick: (id: string, label: string) => void;
}) {
  const dmg = new Set(damageEntries.map((e) => e.zone));
  const fill = (id: string) => (dmg.has(id) ? "#d97706" : "#1e2235");
  const txt = (id: string) => (dmg.has(id) ? "#fff" : "#94a3b8");
  const stroke = "#4a5568";

  const Zone = ({
    id, x, y, w, h, rx = 4,
  }: { id: string; x: number; y: number; w: number; h: number; rx?: number }) => (
    <g onClick={() => onZoneClick(id, VEHICLE_ZONES.find((z) => z.id === id)?.label ?? id)} style={{ cursor: "pointer" }}>
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={fill(id)} stroke={stroke} strokeWidth={1} className="hover:opacity-75 transition-opacity" />
      <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight="bold" fill={txt(id)} style={{ pointerEvents: "none", userSelect: "none" }}>{id}</text>
    </g>
  );

  return (
    <svg viewBox="0 0 220 385" className="w-full max-w-[190px] mx-auto" xmlns="http://www.w3.org/2000/svg">
      <text x="110" y="7" textAnchor="middle" fontSize="8" fill="#64748b">FRONT</text>
      <Zone id="A" x={50} y={10} w={57} h={28} rx={7} />
      <Zone id="B" x={113} y={10} w={57} h={28} rx={7} />
      <Zone id="C" x={38} y={42} w={70} h={85} />
      <Zone id="D" x={112} y={42} w={70} h={85} />
      <Zone id="K" x={8}  y={131} w={28} h={88} />
      <Zone id="E" x={38} y={131} w={70} h={88} />
      <Zone id="F" x={112} y={131} w={70} h={88} />
      <Zone id="M" x={184} y={131} w={28} h={88} />
      <Zone id="L" x={8}  y={223} w={28} h={88} />
      <Zone id="G" x={38} y={223} w={70} h={88} />
      <Zone id="H" x={112} y={223} w={70} h={88} />
      <Zone id="N" x={184} y={223} w={28} h={88} />
      <Zone id="I" x={50} y={315} w={57} h={28} rx={7} />
      <Zone id="J" x={113} y={315} w={57} h={28} rx={7} />
      <text x="110" y="356" textAnchor="middle" fontSize="8" fill="#64748b">REAR</text>
      <text x="3" y="175" textAnchor="middle" fontSize="8" fill="#64748b" transform="rotate(-90,3,175)">DRIVER</text>
      <text x="217" y="175" textAnchor="middle" fontSize="8" fill="#64748b" transform="rotate(90,217,175)">PASS.</text>
    </svg>
  );
}

function InspectionSummary({
  inspection,
  booking,
  onClose,
}: {
  inspection: any;
  booking: any;
  onClose: () => void;
}) {
  const snap = inspection.vehicleSnapshot ?? {};
  const customer = snap.customer ?? {};
  const vehicle = snap.vehicle ?? {};
  const damageEntries: DamageEntry[] = inspection.damageEntries ?? [];
  const lights: string[] = inspection.dashboardLights ?? [];
  const photos: string[] = inspection.beforePhotoUrls ?? [];

  const handlePrint = () => window.print();

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <style>{`@media print { .no-print { display: none !important; } body { background: white; color: black; } }`}</style>

      <div className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0 no-print">
        <div>
          <h2 className="font-bold text-lg">Inspection Summary</h2>
          <p className="text-xs text-muted-foreground">
            Completed {inspection.completedAt ? format(new Date(inspection.completedAt), "MMM d, yyyy 'at' h:mm a") : "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5 border-border" onClick={handlePrint}>
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-muted text-muted-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
          <div className="text-center print:block">
            <h1 className="text-xl font-bold">Vehicle Intake Inspection</h1>
            <p className="text-sm text-muted-foreground">Vivid Detailing — Charlottetown PEI</p>
            <p className="text-xs text-muted-foreground">
              {inspection.completedAt ? format(new Date(inspection.completedAt), "EEEE, MMMM d, yyyy 'at' h:mm a") : ""}
            </p>
          </div>

          <section className="bg-card border border-border rounded-lg p-4 space-y-1">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-2">Customer</h3>
            <p className="font-medium">{customer.name || booking.customer?.name || "—"}</p>
            <p className="text-sm text-muted-foreground">{customer.phone || booking.customer?.phone || ""}</p>
            <p className="text-sm text-muted-foreground">{customer.email || booking.customer?.email || ""}</p>
            {snap.dropoffTime && (
              <p className="text-sm text-muted-foreground">
                Drop-off: {format(new Date(snap.dropoffTime), "MMM d, yyyy 'at' h:mm a")}
              </p>
            )}
          </section>

          <section className="bg-card border border-border rounded-lg p-4 space-y-1">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-2">Vehicle</h3>
            <p className="font-medium">
              {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || booking.vehicle?.type || "—"}
            </p>
            {vehicle.colour && <p className="text-sm text-muted-foreground">Colour: {vehicle.colour}</p>}
            {vehicle.licensePlate && <p className="text-sm text-muted-foreground">Plate: {vehicle.licensePlate}</p>}
            {vehicle.notes && <p className="text-sm text-muted-foreground">Notes: {vehicle.notes}</p>}
          </section>

          <section className="bg-card border border-border rounded-lg p-4">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-3">Vehicle Condition</h3>
            <div className="flex gap-4 flex-wrap">
              <div className="flex-shrink-0 w-44">
                <VehicleDiagram damageEntries={damageEntries} onZoneClick={() => {}} />
              </div>
              <div className="flex-1 min-w-48">
                {damageEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No damage recorded</p>
                ) : (
                  <div className="space-y-2">
                    {damageEntries.map((entry, i) => (
                      <div key={i} className="flex gap-2 text-sm">
                        <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold flex items-center justify-center shrink-0">
                          {entry.zone}
                        </span>
                        <div>
                          <span className="font-medium">{entry.zoneName}</span>
                          <span className="text-muted-foreground ml-1">— {entry.type}, {entry.severity}</span>
                          {entry.notes && <span className="text-muted-foreground"> — {entry.notes}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {lights.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">Dashboard Lights</p>
                <p className="text-sm">{lights.join(", ")}</p>
              </div>
            )}
            {inspection.conditionNotes && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">Condition Notes</p>
                <p className="text-sm">{inspection.conditionNotes}</p>
              </div>
            )}
          </section>

          <section className="bg-card border border-border rounded-lg p-4 space-y-1">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-2">Job Details</h3>
            {inspection.packageOverride && <p className="text-sm"><span className="text-muted-foreground">Package:</span> {inspection.packageOverride}</p>}
            {(inspection.addonsSelected ?? []).length > 0 && (
              <p className="text-sm"><span className="text-muted-foreground">Add-ons:</span> {(inspection.addonsSelected ?? []).join(", ")}</p>
            )}
            {inspection.estimatedPickupAt && (
              <p className="text-sm">
                <span className="text-muted-foreground">Est. Pickup:</span>{" "}
                {format(new Date(inspection.estimatedPickupAt), "MMM d, yyyy 'at' h:mm a")}
              </p>
            )}
            {inspection.jobNotes && (
              <p className="text-sm"><span className="text-muted-foreground">Notes:</span> {inspection.jobNotes}</p>
            )}
          </section>

          {photos.length > 0 && (
            <section className="bg-card border border-border rounded-lg p-4">
              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-3">Before Photos ({photos.length})</h3>
              <div className="grid grid-cols-3 gap-2">
                {photos.map((url, i) => (
                  <div key={i} className="aspect-square rounded overflow-hidden border border-border">
                    <img src={url} alt={`before-${i}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="bg-card border border-border rounded-lg p-4">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-3">Sign Off</h3>
            {inspection.clientPresent === false ? (
              <p className="text-sm text-muted-foreground italic">Client not present at inspection — signature waived.</p>
            ) : inspection.signatureUrl ? (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Customer Signature</p>
                <img src={inspection.signatureUrl} alt="Customer signature" className="border border-border rounded bg-[#0d1117] p-2 max-w-xs" />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Signature not recorded</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export function InspectionFlow({
  booking,
  inspection: initialInspection,
  onClose,
  onComplete,
}: {
  booking: any;
  inspection: any | null;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  if (initialInspection?.status === "completed") {
    return <InspectionSummary inspection={initialInspection} booking={booking} onClose={onClose} />;
  }

  return (
    <InspectionEditor
      booking={booking}
      initialInspection={initialInspection}
      onClose={onClose}
      onComplete={onComplete}
      toast={toast}
      queryClient={queryClient}
    />
  );
}

function InspectionEditor({
  booking,
  initialInspection,
  onClose,
  onComplete,
  toast,
  queryClient,
}: {
  booking: any;
  initialInspection: any | null;
  onClose: () => void;
  onComplete: () => void;
  toast: ReturnType<typeof useToast>["toast"];
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [step, setStep] = useState(1);
  const [inspectionId, setInspectionId] = useState<string | null>(initialInspection?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Step 1
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [vYear, setVYear] = useState("");
  const [vMake, setVMake] = useState("");
  const [vModel, setVModel] = useState("");
  const [vColour, setVColour] = useState("");
  const [vPlate, setVPlate] = useState("");
  const [vNotes, setVNotes] = useState("");
  const [dropoffTime, setDropoffTime] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));

  // Step 2
  const [damageEntries, setDamageEntries] = useState<DamageEntry[]>([]);
  const [activeZone, setActiveZone] = useState<{ id: string; label: string } | null>(null);
  const [zoneForm, setZoneForm] = useState({ type: "Scratch", severity: "Minor", notes: "" });
  const [dashboardLights, setDashboardLights] = useState<string[]>([]);
  const [dashboardOther, setDashboardOther] = useState("");
  const [conditionNotes, setConditionNotes] = useState("");

  // Step 3
  const [services, setServices] = useState<any[]>([]);
  const [allAddons, setAllAddons] = useState<any[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string>("");
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  const [pickupTime, setPickupTime] = useState("");
  const [jobNotes, setJobNotes] = useState("");

  // Step 4
  const [beforePhotoUrls, setBeforePhotoUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Step 5
  const [clientPresent, setClientPresent] = useState(true);
  const [hasSignature, setHasSignature] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);

  // Initialise from booking + existing inspection
  useEffect(() => {
    const name = booking.customer?.name ?? "";
    const parts = name.split(" ");
    setFirstName(parts[0] ?? "");
    setLastName(parts.slice(1).join(" "));
    setPhone(booking.customer?.phone ?? "");
    setEmail(booking.customer?.email ?? "");
    setVYear(booking.vehicle?.year ? String(booking.vehicle.year) : "");
    setVMake(booking.vehicle?.make ?? "");
    setVModel(booking.vehicle?.model ?? "");
    setVColour(booking.vehicle?.colour ?? "");
    setVPlate(booking.vehicle?.licensePlate ?? "");
    setVNotes(booking.vehicle?.notes ?? "");
    if (booking.estimatedPickupAt) {
      setPickupTime(format(new Date(booking.estimatedPickupAt), "yyyy-MM-dd'T'HH:mm"));
    }

    if (initialInspection) {
      const snap = initialInspection.vehicleSnapshot ?? {};
      if (snap.customer) {
        const n = snap.customer.name ?? "";
        const p = n.split(" ");
        setFirstName(p[0] ?? "");
        setLastName(p.slice(1).join(" "));
        if (snap.customer.phone) setPhone(snap.customer.phone);
        if (snap.customer.email) setEmail(snap.customer.email);
      }
      if (snap.vehicle) {
        if (snap.vehicle.year) setVYear(String(snap.vehicle.year));
        if (snap.vehicle.make) setVMake(snap.vehicle.make);
        if (snap.vehicle.model) setVModel(snap.vehicle.model);
        if (snap.vehicle.colour) setVColour(snap.vehicle.colour);
        if (snap.vehicle.licensePlate) setVPlate(snap.vehicle.licensePlate);
        if (snap.vehicle.notes) setVNotes(snap.vehicle.notes);
      }
      if (snap.dropoffTime) setDropoffTime(snap.dropoffTime);

      setDamageEntries(initialInspection.damageEntries ?? []);
      const rawLights: string[] = initialInspection.dashboardLights ?? [];
      const otherLine = rawLights.find((l) => l.startsWith("Other:"));
      setDashboardLights(rawLights.filter((l) => !l.startsWith("Other:")));
      if (otherLine) setDashboardOther(otherLine.replace("Other:", "").trim());
      setConditionNotes(initialInspection.conditionNotes ?? "");
      if (initialInspection.packageOverride) setSelectedPackageId(initialInspection.packageOverride);
      setSelectedAddonIds(initialInspection.addonsSelected ?? []);
      if (initialInspection.estimatedPickupAt) {
        setPickupTime(format(new Date(initialInspection.estimatedPickupAt), "yyyy-MM-dd'T'HH:mm"));
      }
      setJobNotes(initialInspection.jobNotes ?? "");
      setBeforePhotoUrls(initialInspection.beforePhotoUrls ?? []);
      setClientPresent(initialInspection.clientPresent ?? true);
    }
  }, [booking.id]);

  // Fetch services and addons
  useEffect(() => {
    fetch("/api/admin/services").then((r) => (r.ok ? r.json() : [])).then(setServices).catch(() => {});
    fetch("/api/admin/add-ons").then((r) => (r.ok ? r.json() : [])).then(setAllAddons).catch(() => {});
  }, []);

  const ensureInspection = useCallback(async (): Promise<string> => {
    if (inspectionId) return inspectionId;
    const res = await fetch("/api/admin/inspections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId: booking.id }),
    });
    if (!res.ok) throw new Error("Failed to create inspection");
    const data = await res.json();
    setInspectionId(data.id);
    return data.id as string;
  }, [inspectionId, booking.id]);

  const saveInspection = useCallback(async (updates: Record<string, unknown>): Promise<void> => {
    const id = await ensureInspection();
    const res = await fetch(`/api/admin/inspections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error("Failed to save");
  }, [ensureInspection]);

  const buildLights = () => [
    ...dashboardLights,
    ...(dashboardLights.includes("Other") && dashboardOther ? [`Other: ${dashboardOther}`] : []),
  ];

  const handleNext = async () => {
    setSaving(true);
    try {
      if (step === 1) {
        const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
        if (booking.customer?.id && fullName) {
          await fetch(`/api/admin/customers/${booking.customer.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: fullName, phone: phone.trim() }),
          });
        }
        if (booking.vehicle?.id) {
          await fetch(`/api/admin/vehicles/${booking.vehicle.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              year: vYear ? parseInt(vYear) : null,
              make: vMake || null,
              model: vModel || null,
              colour: vColour || null,
              licensePlate: vPlate || null,
            }),
          });
        }
        await saveInspection({
          vehicleSnapshot: {
            customer: { name: fullName, phone, email },
            vehicle: { year: vYear ? parseInt(vYear) : null, make: vMake, model: vModel, colour: vColour, licensePlate: vPlate, notes: vNotes },
            dropoffTime,
          },
        });
        queryClient.invalidateQueries();
      } else if (step === 2) {
        await saveInspection({ damageEntries, dashboardLights: buildLights(), conditionNotes: conditionNotes || null });
      } else if (step === 3) {
        await saveInspection({
          packageOverride: selectedPackageId || null,
          addonsSelected: selectedAddonIds,
          estimatedPickupAt: pickupTime || null,
          jobNotes: jobNotes || null,
        });
        if (pickupTime) {
          await fetch(`/api/admin/bookings/${booking.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ estimatedPickupAt: pickupTime }),
          }).catch(() => {});
        }
      } else if (step === 4) {
        await saveInspection({ beforePhotoUrls });
      }
      setStep((s) => s + 1);
    } catch {
      toast({ variant: "destructive", title: "Save failed — please try again" });
    } finally {
      setSaving(false);
    }
  };

  const handleBack = async () => {
    if (step === 1) { onClose(); return; }
    setSaving(true);
    try {
      if (step === 2) await saveInspection({ damageEntries, dashboardLights: buildLights(), conditionNotes: conditionNotes || null });
      else if (step === 3) await saveInspection({ packageOverride: selectedPackageId || null, addonsSelected: selectedAddonIds, estimatedPickupAt: pickupTime || null, jobNotes: jobNotes || null });
      else if (step === 4) await saveInspection({ beforePhotoUrls });
    } catch {} finally {
      setSaving(false);
    }
    setStep((s) => s - 1);
  };

  // Signature canvas
  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    }
    return { x: ((e as React.MouseEvent).clientX - rect.left) * scaleX, y: ((e as React.MouseEvent).clientY - rect.top) * scaleY };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    isDrawingRef.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e, canvas);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDraw = () => { isDrawingRef.current = false; };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const uploadSignature = (): Promise<string | null> =>
    new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas) return resolve(null);
      canvas.toBlob(async (blob) => {
        if (!blob) return resolve(null);
        try {
          const metaRes = await fetch("/api/storage/uploads/request-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "signature.png", contentType: "image/png", bookingId: booking.id, photoType: "signature" }),
          });
          if (!metaRes.ok) return resolve(null);
          const { uploadURL, objectPath } = await metaRes.json();
          const putRes = await fetch(uploadURL, { method: "PUT", body: blob, headers: { "Content-Type": "image/png" } });
          resolve(putRes.ok ? (objectPath as string) : null);
        } catch { resolve(null); }
      }, "image/png");
    });

  const uploadPhoto = async (file: File): Promise<string | null> => {
    const metaRes = await fetch("/api/storage/uploads/request-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "image/jpeg", bookingId: booking.id, photoType: "before" }),
    });
    if (!metaRes.ok) return null;
    const { uploadURL, objectPath } = await metaRes.json();
    const putRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type || "image/jpeg" } });
    return putRes.ok ? (objectPath as string) : null;
  };

  const handleAddPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const paths: string[] = [];
      for (const file of Array.from(files)) {
        const url = await uploadPhoto(file);
        if (url) paths.push(url);
      }
      setBeforePhotoUrls((prev) => [...prev, ...paths]);
    } catch {
      toast({ variant: "destructive", title: "Upload failed" });
    } finally {
      setUploading(false);
    }
  };

  const handleComplete = async () => {
    if (clientPresent && !hasSignature) {
      toast({ variant: "destructive", title: "Please provide a signature or mark the client as not present" });
      return;
    }
    setCompleting(true);
    try {
      let signatureUrl: string | null = null;
      if (clientPresent && hasSignature) signatureUrl = await uploadSignature();

      const id = await ensureInspection();
      await fetch(`/api/admin/inspections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beforePhotoUrls, signatureUrl, clientPresent }),
      });

      const completeRes = await fetch(`/api/admin/inspections/${id}/complete`, { method: "POST" });
      if (!completeRes.ok) throw new Error("Complete failed");

      queryClient.invalidateQueries();
      setShowSuccess(true);
      setTimeout(() => { onComplete(); }, 2500);
    } catch {
      toast({ variant: "destructive", title: "Failed to complete inspection — please try again" });
    } finally {
      setCompleting(false);
    }
  };

  const handleAddDamage = () => {
    if (!activeZone) return;
    const entry: DamageEntry = {
      id: crypto.randomUUID(),
      zone: activeZone.id,
      zoneName: activeZone.label,
      type: zoneForm.type,
      severity: zoneForm.severity,
      notes: zoneForm.notes,
    };
    setDamageEntries((prev) => [...prev, entry]);
    setActiveZone(null);
    setZoneForm({ type: "Scratch", severity: "Minor", notes: "" });
  };

  const vehicleType = booking.vehicle?.type ?? "car";
  const getServicePrice = (svc: any) => {
    const p = (svc.prices ?? []).find((x: any) => x.vehicleType === vehicleType);
    return p ? Number(p.price) : Number(svc.basePrice ?? 0);
  };
  const getAddonPrice = (addon: any) => {
    const p = (addon.prices ?? []).find((x: any) => x.vehicleType === vehicleType);
    return p ? Number(p.price) : 0;
  };
  const selectedService = services.find((s) => s.id === selectedPackageId);
  const svcTotal = selectedService ? getServicePrice(selectedService) : 0;
  const addonTotal = selectedAddonIds.reduce((sum, id) => {
    const a = allAddons.find((x) => x.id === id);
    return sum + (a ? getAddonPrice(a) : 0);
  }, 0);
  const subtotal = svcTotal + addonTotal;
  const runningTotal = Math.round(subtotal * 1.15 * 100) / 100;

  if (showSuccess) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-4">
        <CheckCircle2 className="h-20 w-20 text-green-500" />
        <h2 className="text-2xl font-bold">Inspection Complete</h2>
        <p className="text-muted-foreground">Job is now in progress.</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0">
        <div>
          <h2 className="font-bold text-lg">Vehicle Intake Inspection</h2>
          <p className="text-xs text-muted-foreground">
            {[booking.vehicle?.year, booking.vehicle?.make, booking.vehicle?.model].filter(Boolean).join(" ") || "Vehicle"} — {booking.customer?.name ?? "Customer"}
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Step indicator */}
      <div className="px-4 py-2 border-b border-border shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {STEP_TITLES.map((title, i) => {
            const n = i + 1;
            const active = n === step;
            const done = n < step;
            return (
              <button
                key={n}
                onClick={() => done && setStep(n)}
                disabled={n > step}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  active ? "bg-primary text-primary-foreground"
                  : done ? "bg-primary/20 text-primary hover:bg-primary/30 cursor-pointer"
                  : "bg-muted text-muted-foreground"
                }`}
              >
                <span className="w-4 h-4 rounded-full bg-black/10 flex items-center justify-center text-[10px] font-bold">
                  {done ? "✓" : n}
                </span>
                <span className="hidden sm:inline">{title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

          {/* ── Step 1 ── */}
          {step === 1 && (
            <>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Customer Information</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-muted-foreground mb-1 block">First Name</label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="bg-card border-border" /></div>
                  <div><label className="text-xs text-muted-foreground mb-1 block">Last Name</label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} className="bg-card border-border" /></div>
                  <div><label className="text-xs text-muted-foreground mb-1 block">Phone Number</label><Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" className="bg-card border-border" /></div>
                  <div><label className="text-xs text-muted-foreground mb-1 block">Email Address</label><Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="bg-card border-border" /></div>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Vehicle Information</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-muted-foreground mb-1 block">Year</label><Input value={vYear} onChange={(e) => setVYear(e.target.value)} placeholder="e.g. 2021" className="bg-card border-border" /></div>
                  <div><label className="text-xs text-muted-foreground mb-1 block">Make</label><Input value={vMake} onChange={(e) => setVMake(e.target.value)} placeholder="e.g. Toyota" className="bg-card border-border" /></div>
                  <div><label className="text-xs text-muted-foreground mb-1 block">Model</label><Input value={vModel} onChange={(e) => setVModel(e.target.value)} placeholder="e.g. Camry" className="bg-card border-border" /></div>
                  <div><label className="text-xs text-muted-foreground mb-1 block">Colour</label><Input value={vColour} onChange={(e) => setVColour(e.target.value)} placeholder="e.g. Silver" className="bg-card border-border" /></div>
                  <div><label className="text-xs text-muted-foreground mb-1 block">Licence Plate</label><Input value={vPlate} onChange={(e) => setVPlate(e.target.value)} placeholder="e.g. ABC 123" className="bg-card border-border" /></div>
                  <div><label className="text-xs text-muted-foreground mb-1 block">Drop-off Time</label><Input type="datetime-local" value={dropoffTime} onChange={(e) => setDropoffTime(e.target.value)} className="bg-card border-border" /></div>
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground mb-1 block">Additional Vehicle Notes</label>
                    <textarea value={vNotes} onChange={(e) => setVNotes(e.target.value)} rows={2} placeholder="Modifications, aftermarket parts, special instructions…" className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Step 2 ── */}
          {step === 2 && (
            <>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Vehicle Diagram</h3>
                <p className="text-xs text-muted-foreground mb-3">Tap a zone to record damage. Amber zones have entries.</p>
                <div className="flex gap-4 items-start flex-wrap">
                  <div className="w-48 shrink-0">
                    <VehicleDiagram
                      damageEntries={damageEntries}
                      onZoneClick={(id, label) => {
                        setActiveZone({ id, label });
                        setZoneForm({ type: "Scratch", severity: "Minor", notes: "" });
                      }}
                    />
                    <button className="mt-1 text-xs text-muted-foreground underline w-full text-center" onClick={() => { setActiveZone({ id: "O", label: "Undercarriage / other" }); setZoneForm({ type: "Scratch", severity: "Minor", notes: "" }); }}>
                      + Undercarriage / Other (O)
                    </button>
                  </div>

                  {activeZone && (
                    <div className="flex-1 min-w-56 bg-card border border-border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-sm">Zone {activeZone.id}: {activeZone.label}</p>
                        <button onClick={() => setActiveZone(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Damage Type</label>
                        <Select value={zoneForm.type} onValueChange={(v) => setZoneForm((p) => ({ ...p, type: v }))}>
                          <SelectTrigger className="bg-background border-border h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>{DAMAGE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Severity</label>
                        <div className="flex gap-2">
                          {SEVERITIES.map((s) => (
                            <button key={s} onClick={() => setZoneForm((p) => ({ ...p, severity: s }))}
                              className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
                                zoneForm.severity === s
                                  ? s === "Minor" ? "bg-green-500/20 border-green-500/40 text-green-400"
                                    : s === "Moderate" ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-400"
                                    : "bg-red-500/20 border-red-500/40 text-red-400"
                                  : "border-border text-muted-foreground hover:border-primary/40"
                              }`}
                            >{s}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Notes (optional)</label>
                        <Input value={zoneForm.notes} onChange={(e) => setZoneForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Additional details…" className="bg-background border-border text-sm h-9" />
                      </div>
                      <Button size="sm" className="w-full" onClick={handleAddDamage}>Add Entry</Button>
                    </div>
                  )}
                </div>

                {damageEntries.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recorded Damage ({damageEntries.length})</p>
                    {damageEntries.map((entry) => (
                      <div key={entry.id} className="flex items-start gap-3 bg-card border border-amber-500/20 rounded-lg p-3">
                        <span className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold flex items-center justify-center shrink-0">{entry.zone}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{entry.zoneName}</p>
                          <p className="text-xs text-muted-foreground">{entry.type} · {entry.severity}{entry.notes ? ` · ${entry.notes}` : ""}</p>
                        </div>
                        <button onClick={() => setDamageEntries((prev) => prev.filter((e) => e.id !== entry.id))} className="text-muted-foreground hover:text-red-400 transition-colors shrink-0">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Dashboard Warning Lights</h3>
                <div className="grid grid-cols-2 gap-2">
                  {DASHBOARD_LIGHTS.map((light) => (
                    <label key={light} className="flex items-center gap-2.5 cursor-pointer">
                      <Checkbox checked={dashboardLights.includes(light)} onCheckedChange={(c) => { if (c) setDashboardLights((p) => [...p, light]); else setDashboardLights((p) => p.filter((l) => l !== light)); }} className="border-border" />
                      <span className="text-sm">{light}</span>
                    </label>
                  ))}
                </div>
                {dashboardLights.includes("Other") && (
                  <Input value={dashboardOther} onChange={(e) => setDashboardOther(e.target.value)} placeholder="Describe other warning light…" className="mt-2 bg-card border-border text-sm" />
                )}
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">General Condition Notes</h3>
                <textarea value={conditionNotes} onChange={(e) => setConditionNotes(e.target.value)} rows={3} placeholder="Overall vehicle condition, existing damage not captured above…" className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
            </>
          )}

          {/* ── Step 3 ── */}
          {step === 3 && (
            <>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Package</h3>
                <Select value={selectedPackageId} onValueChange={setSelectedPackageId}>
                  <SelectTrigger className="bg-card border-border"><SelectValue placeholder="Select a package…" /></SelectTrigger>
                  <SelectContent>
                    {services.filter((s) => s.isActive).map((s) => {
                      const p = getServicePrice(s);
                      return <SelectItem key={s.id} value={s.id}>{s.name}{p > 0 ? ` — $${p.toFixed(2)}` : " — Quote"}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Add-Ons</h3>
                <div className="space-y-2">
                  {allAddons.filter((a) => a.isActive).map((addon) => {
                    const p = getAddonPrice(addon);
                    return (
                      <label key={addon.id} className="flex items-center gap-3 cursor-pointer">
                        <Checkbox checked={selectedAddonIds.includes(addon.id)} onCheckedChange={(c) => { if (c) setSelectedAddonIds((prev) => [...prev, addon.id]); else setSelectedAddonIds((prev) => prev.filter((id) => id !== addon.id)); }} className="border-border" />
                        <span className="flex-1 text-sm">{addon.name}</span>
                        <span className="text-sm text-muted-foreground shrink-0">{p > 0 ? `$${p.toFixed(2)}` : "—"}</span>
                      </label>
                    );
                  })}
                  {allAddons.length === 0 && <p className="text-sm text-muted-foreground">Loading add-ons…</p>}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Estimated Pickup Time</h3>
                <Input type="datetime-local" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} className="bg-card border-border" />
                <p className="text-xs text-muted-foreground mt-1">Saves to booking record and notifies GHL.</p>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Job Notes</h3>
                <textarea value={jobNotes} onChange={(e) => setJobNotes(e.target.value)} rows={3} placeholder="Internal notes for the team…" className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>

              <div className="bg-card border border-border rounded-lg p-4">
                <p className="text-sm font-semibold mb-3">Running Total</p>
                {selectedService && <div className="flex justify-between text-sm mb-1"><span>{selectedService.name}</span><span>${getServicePrice(selectedService).toFixed(2)}</span></div>}
                {selectedAddonIds.map((id) => {
                  const a = allAddons.find((x) => x.id === id);
                  if (!a) return null;
                  return <div key={id} className="flex justify-between text-sm mb-1 text-muted-foreground"><span>{a.name}</span><span>${getAddonPrice(a).toFixed(2)}</span></div>;
                })}
                <div className="border-t border-border mt-2 pt-2 space-y-1">
                  <div className="flex justify-between text-sm text-muted-foreground"><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
                  <div className="flex justify-between text-sm text-muted-foreground"><span>HST (15%)</span><span>${(runningTotal - subtotal).toFixed(2)}</span></div>
                  <div className="flex justify-between font-bold text-lg pt-1"><span>Total</span><span>${runningTotal.toFixed(2)}</span></div>
                </div>
              </div>
            </>
          )}

          {/* ── Step 4 ── */}
          {step === 4 && (
            <>
              <div className="flex gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">Photos protect you and your customer — document the vehicle before work begins.</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Before Photos</h3>
                  <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs border-border" disabled={uploading} onClick={() => photoInputRef.current?.click()}>
                    {uploading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    {uploading ? "Uploading…" : "Add Photos"}
                  </Button>
                  <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { handleAddPhotos(e.target.files); e.target.value = ""; }} />
                </div>

                {beforePhotoUrls.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {beforePhotoUrls.map((url, i) => (
                      <div key={i} className="relative group aspect-square rounded overflow-hidden border border-border">
                        <img src={url} alt={`before-${i}`} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button onClick={() => setBeforePhotoUrls((prev) => prev.filter((_, j) => j !== i))} className="p-1.5 bg-red-600/80 rounded text-white hover:bg-red-600">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="aspect-square rounded border border-dashed border-border flex items-center justify-center cursor-pointer hover:border-primary/40 transition-colors" onClick={() => photoInputRef.current?.click()}>
                      <Camera className="h-6 w-6 text-muted-foreground" />
                    </div>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-border rounded-xl p-12 text-center cursor-pointer hover:border-primary/40 transition-colors" onClick={() => photoInputRef.current?.click()}>
                    <Camera className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Click to add photos</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Multiple files supported</p>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">This step is optional but highly recommended.</p>
            </>
          )}

          {/* ── Step 5 ── */}
          {step === 5 && (
            <>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Customer Agreement</h3>
                <div className="bg-card border border-border rounded-lg p-4 max-h-56 overflow-y-auto">
                  <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{DISCLAIMER}</p>
                </div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <Checkbox checked={!clientPresent} onCheckedChange={(c) => setClientPresent(!c)} className="border-border" />
                <span className="text-sm">Client not present at inspection — signature waived</span>
              </label>

              {clientPresent && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Signature</h3>
                    <button onClick={clearSignature} className="text-xs text-muted-foreground hover:text-foreground underline">Clear</button>
                  </div>
                  <div className="border-2 border-border rounded-lg overflow-hidden bg-[#0d1117]">
                    <canvas
                      ref={canvasRef}
                      width={600}
                      height={180}
                      className="w-full touch-none"
                      style={{ cursor: "crosshair" }}
                      onMouseDown={startDraw}
                      onMouseMove={draw}
                      onMouseUp={stopDraw}
                      onMouseLeave={stopDraw}
                      onTouchStart={startDraw}
                      onTouchMove={draw}
                      onTouchEnd={stopDraw}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 text-center">Sign with finger or mouse above</p>
                </div>
              )}

              <Button
                className="w-full bg-green-600 hover:bg-green-700 text-white h-12 text-base font-semibold gap-2"
                onClick={handleComplete}
                disabled={completing}
              >
                {completing ? <><RefreshCw className="h-4 w-4 animate-spin" /> Completing…</> : <><CheckCircle2 className="h-4 w-4" /> Complete Inspection</>}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Footer nav */}
      <div className="border-t border-border px-4 py-3 flex items-center justify-between shrink-0 bg-background">
        <Button variant="ghost" onClick={handleBack} disabled={saving} className="gap-1">
          <ChevronLeft className="h-4 w-4" />{step === 1 ? "Cancel" : "Back"}
        </Button>
        {saving && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
        {step < 5 && (
          <Button onClick={handleNext} disabled={saving} className="gap-1 bg-primary text-primary-foreground hover:bg-primary/90">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
