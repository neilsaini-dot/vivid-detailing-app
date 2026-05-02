import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sun, Shield, Eye, Droplet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const VLT_LEVELS = [
  { vlt: 5,  label: "5% — Limo",       desc: ["Maximum privacy (\"Limo Tint\")", "Excellent heat rejection", "Hardest to see out of at night"] },
  { vlt: 15, label: "15% — Very Dark", desc: ["High privacy level", "Matches most factory rear window tints", "Great glare reduction"] },
  { vlt: 25, label: "25% — Dark",      desc: ["Popular choice for side windows", "Strong privacy and heat rejection", "Sleek, aggressive look"] },
  { vlt: 35, label: "35% — Medium",    desc: ["Legal for front windows in many provinces", "Good balance of privacy and visibility", "Elegant, understated finish"] },
  { vlt: 50, label: "50% — Light",     desc: ["Light tint, highly visible interior", "Excellent nighttime visibility", "Still provides UV and heat protection"] },
];

export default function TintVisualizer() {
  const [vlt, setVlt] = useState<number>(35);

  // Convert VLT % → overlay opacity
  // 5% VLT = very dark window → high overlay opacity
  // 50% VLT = light window → low overlay opacity
  const getOverlayOpacity = (vltValue: number) => {
    const mapped: Record<number, number> = {
      5: 0.80,
      15: 0.62,
      25: 0.46,
      35: 0.30,
      50: 0.14,
    };
    return mapped[vltValue] ?? 0.30;
  };

  const currentLevel = VLT_LEVELS.find((l) => l.vlt === vlt) ?? VLT_LEVELS[3];
  const overlayOpacity = getOverlayOpacity(vlt);

  return (
    <div className="container py-12 max-w-5xl">
      <div className="mb-10 text-center">
        <p className="text-sm font-semibold tracking-widest uppercase text-primary mb-3">Interactive Preview</p>
        <h1 className="text-4xl font-bold tracking-tight mb-4">Window Tint Visualizer</h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Drag the slider to preview how different tint percentages look on a real vehicle. VLT (Visible Light Transmission) — the lower the number, the darker the tint.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-10 items-start mb-16">

        {/* Car Photo with Tint Overlay */}
        <div className="space-y-4">
          <div className="relative aspect-video rounded-xl border border-border overflow-hidden bg-black shadow-xl shadow-black/40">
            {/* Real car photo */}
            <img
              src="/tint-car.png"
              alt="Vehicle for tint preview"
              className="absolute inset-0 w-full h-full object-cover"
              draggable={false}
            />

            {/* Tint overlay — dark blue-grey to mimic real window film */}
            <div
              className="absolute inset-0 transition-opacity duration-300 pointer-events-none"
              style={{
                background: "linear-gradient(160deg, rgba(8,18,35,1) 0%, rgba(15,28,55,0.95) 100%)",
                opacity: overlayOpacity,
                mixBlendMode: "multiply",
              }}
            />

            {/* Logo watermark in corner */}
            <div className="absolute bottom-3 right-3 opacity-60">
              <img src="/logo.png" alt="Vivid Detailing" className="h-8 w-8 object-contain" />
            </div>

            {/* VLT badge */}
            <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm border border-white/10 rounded-full px-3 py-1 text-xs font-bold text-white tracking-widest">
              {vlt}% VLT
            </div>
          </div>

          {/* Quick-select VLT swatches */}
          <div className="flex items-center gap-2 justify-center">
            {VLT_LEVELS.map((l) => (
              <button
                key={l.vlt}
                onClick={() => setVlt(l.vlt)}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                  vlt === l.vlt
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                <span
                  className="w-6 h-4 rounded-sm border border-white/10"
                  style={{ background: `rgba(8,18,35,${getOverlayOpacity(l.vlt)})` }}
                />
                {l.vlt}%
              </button>
            ))}
          </div>
        </div>

        {/* Controls & Info */}
        <div className="space-y-6">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-2xl">{currentLevel.label}</CardTitle>
              <CardDescription>Drag the slider or tap a percentage above to preview.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Slider
                  defaultValue={[35]}
                  max={50}
                  min={5}
                  step={10}
                  value={[vlt]}
                  onValueChange={(val) => setVlt(val[0])}
                  className="py-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>5%</span>
                  <span>15%</span>
                  <span>25%</span>
                  <span>35%</span>
                  <span>50%</span>
                </div>
              </div>

              <div className="pt-2 border-t border-border space-y-2">
                <h4 className="font-semibold text-sm mb-3">At {vlt}% VLT:</h4>
                {currentLevel.desc.map((d) => (
                  <div key={d} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="text-primary mt-0.5">•</span>
                    <span>{d}</span>
                  </div>
                ))}
              </div>

              <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground border border-border">
                <span className="font-semibold text-foreground block mb-1">PEI Legal Note</span>
                Front side windows must allow at least 35% VLT. Rear windows and the back windshield have no restriction.
              </div>

              <Link href={`/book?intent=tint&vlt=${vlt}`}>
                <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                  Book Tinting at {vlt}% VLT
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Feature cards */}
      <div className="grid md:grid-cols-4 gap-5">
        {[
          { Icon: Sun,    title: "99% UV Rejection",        body: "Protects your interior from fading and your skin from harmful UV radiation." },
          { Icon: Shield, title: "Heat Rejection",           body: "Ceramic films block infrared heat, keeping your cabin significantly cooler." },
          { Icon: Eye,    title: "Glare Reduction",          body: "Reduces eye strain from sun and headlights for safer, more comfortable driving." },
          { Icon: Droplet,title: "Carbon & Ceramic Films",   body: "Advanced color-stable films — will never turn purple, bubble, or delaminate." },
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
