import { useState, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Sun, Shield, Eye, Droplet, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const VLT_LEVELS = [
  { vlt: 5,  label: "5% — Limo",       desc: ["Maximum privacy (\"Limo Tint\")", "Excellent heat rejection", "Hardest to see out of at night"] },
  { vlt: 15, label: "15% — Very Dark", desc: ["High privacy level", "Matches most factory rear window tints", "Great glare reduction"] },
  { vlt: 25, label: "25% — Dark",      desc: ["Popular choice for side windows", "Strong privacy and heat rejection", "Sleek, aggressive look"] },
  { vlt: 35, label: "35% — Medium",    desc: ["Good balance of privacy and visibility", "Elegant, understated finish", "Popular all-around choice"] },
  { vlt: 50, label: "50% — Light",     desc: ["Light tint, visible interior", "Excellent nighttime visibility", "Still provides UV and heat protection"] },
];

/*
  Multiply blend mode naturally darkens bright areas (glass) far more than
  dark areas (car body/pillars), so no polygon masking is needed.
  These opacity values are tuned so 5% feels nearly opaque and 50% is subtle.
*/
const VLT_OPACITY: Record<number, number> = {
  5: 0.92, 15: 0.76, 25: 0.58, 35: 0.38, 50: 0.15,
};

const SWATCH_COLOR = (opacity: number) =>
  `rgba(8,12,20,${opacity})`;

export default function TintVisualizer() {
  const [vlt, setVlt] = useState<number>(35);
  const [splitPos, setSplitPos] = useState<number>(50);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentLevel = VLT_LEVELS.find((l) => l.vlt === vlt) ?? VLT_LEVELS[3];
  const opacity = VLT_OPACITY[vlt] ?? 0.38;

  const updateSplit = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSplitPos(Math.min(95, Math.max(5, pct)));
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    updateSplit(e.clientX);
  }, [dragging, updateSplit]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    updateSplit(e.touches[0].clientX);
  }, [updateSplit]);

  return (
    <div className="container py-12 max-w-5xl">
      {/* Header */}
      <div className="mb-10 text-center">
        <p className="text-sm font-semibold tracking-widest uppercase text-primary mb-3">Interactive Preview</p>
        <h1 className="text-4xl font-bold tracking-tight mb-4">Window Tint Visualizer</h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Drag the divider to compare tinted vs. clear glass in real time. Use the percentage buttons to choose your film darkness.
        </p>
      </div>

      {/* Before / After Reveal */}
      <div
        ref={containerRef}
        className="relative aspect-video rounded-xl border border-border overflow-hidden bg-black shadow-xl shadow-black/50 mb-5 select-none"
        style={{ cursor: dragging ? "col-resize" : "ew-resize" }}
        onMouseMove={onMouseMove}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
        onTouchMove={onTouchMove}
        onTouchEnd={() => setDragging(false)}
      >
        {/* ── BEFORE (clear glass) — always full width beneath ── */}
        <div className="absolute inset-0">
          <img
            src="/tint-car.png"
            alt="Clear windows"
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
        </div>

        {/* ── AFTER (tinted) — clipped to right of divider ── */}
        <div
          className="absolute inset-0"
          style={{ clipPath: `inset(0 0 0 ${splitPos}%)` }}
        >
          {/* Same base car photo */}
          <img
            src="/tint-car.png"
            alt="Tinted windows"
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
          {/*
            Dark overlay with multiply blend mode.
            Multiply darkens bright pixels (the glass/sky) much more than
            dark pixels (the car body), so only the glass noticeably changes.
            No polygon coordinates or masks needed.
          */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "rgb(6, 10, 18)",
              mixBlendMode: "multiply",
              opacity,
              transition: "opacity 0.3s ease",
            }}
          />
        </div>

        {/* ── Divider line ── */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white/90 shadow-[0_0_10px_rgba(255,255,255,0.7)]"
          style={{ left: `${splitPos}%` }}
        />

        {/* ── Drag handle ── */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 flex items-center justify-center w-10 h-10 rounded-full bg-white shadow-lg shadow-black/50 cursor-col-resize"
          style={{ left: `${splitPos}%` }}
          onMouseDown={(e) => { e.preventDefault(); setDragging(true); }}
          onTouchStart={(e) => { e.preventDefault(); setDragging(true); }}
        >
          <ChevronLeft size={14} className="text-gray-700 -mr-0.5" />
          <ChevronRight size={14} className="text-gray-700 -ml-0.5" />
        </div>

        {/* ── Labels ── */}
        <div
          className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-bold text-white tracking-widest pointer-events-none transition-opacity duration-200"
          style={{ opacity: splitPos > 15 ? 1 : 0 }}
        >
          BEFORE
        </div>
        <div
          className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-bold text-white tracking-widest pointer-events-none transition-opacity duration-200"
          style={{ opacity: splitPos < 85 ? 1 : 0 }}
        >
          {vlt}% VLT
        </div>

        {/* ── Logo watermark ── */}
        <div className="absolute bottom-3 right-3 opacity-50 pointer-events-none">
          <img src="/logo.png" alt="Vivid Detailing" className="h-7 w-7 object-contain" />
        </div>
      </div>

      {/* VLT selector swatches */}
      <div className="flex items-center justify-center gap-2 mb-10">
        {VLT_LEVELS.map((l) => (
          <button
            key={l.vlt}
            onClick={() => setVlt(l.vlt)}
            className={`flex flex-col items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
              vlt === l.vlt
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            <span
              className="w-8 h-5 rounded border border-white/10"
              style={{ background: SWATCH_COLOR(VLT_OPACITY[l.vlt]) }}
            />
            {l.vlt}%
          </button>
        ))}
      </div>

      {/* Info + CTA */}
      <div className="grid md:grid-cols-2 gap-8 mb-12">
        <Card className="bg-card border-border">
          <CardContent className="pt-6 space-y-3">
            <h3 className="text-lg font-bold">{currentLevel.label}</h3>
            {currentLevel.desc.map((d) => (
              <div key={d} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="text-primary mt-0.5">•</span>
                <span>{d}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="bg-card border-border flex flex-col justify-between">
          <CardContent className="pt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Happy with how <span className="text-foreground font-semibold">{vlt}% VLT</span> looks? Lock in your appointment and we'll have it installed in a single visit.
            </p>
            <Link href={`/book?intent=tint&vlt=${vlt}`}>
              <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                Book Tinting at {vlt}% VLT
              </Button>
            </Link>
            <Link href="/quote">
              <Button variant="outline" className="w-full border-border hover:border-primary/40">
                Request a Custom Quote
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Feature cards */}
      <div className="grid md:grid-cols-4 gap-5">
        {[
          { Icon: Sun,     title: "99% UV Rejection",      body: "Protects your interior from fading and your skin from harmful UV radiation." },
          { Icon: Shield,  title: "Heat Rejection",         body: "Ceramic films block infrared heat, keeping your cabin significantly cooler." },
          { Icon: Eye,     title: "Glare Reduction",        body: "Reduces eye strain from sun and headlights for safer, more comfortable driving." },
          { Icon: Droplet, title: "Carbon & Ceramic Films", body: "Advanced color-stable films — will never turn purple, bubble, or delaminate." },
        ].map(({ Icon, title, body }) => (
          <Card key={title} className="bg-card border-border">
            <CardContent className="pt-6">
              <Icon className="h-7 w-7 text-primary mb-4" />
              <h3 className="font-semibold mb-2 text-sm">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
