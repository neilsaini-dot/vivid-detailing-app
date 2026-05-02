import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sun, Shield, Eye, Droplet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function TintVisualizer() {
  const [vlt, setVlt] = useState<number>(35);

  // Map VLT percentage to opacity (approximate representation)
  // 5% VLT = very dark (0.85 opacity)
  // 50% VLT = lighter (0.25 opacity)
  const getOpacity = (vltValue: number) => {
    if (vltValue <= 5) return 0.85;
    if (vltValue <= 15) return 0.7;
    if (vltValue <= 25) return 0.55;
    if (vltValue <= 35) return 0.4;
    return 0.25;
  };

  const currentOpacity = getOpacity(vlt);

  return (
    <div className="container py-12 max-w-5xl">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight mb-4">Window Tint Visualizer</h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Experience how different tint percentages look. VLT (Visible Light Transmission) indicates how much light passes through the film. Lower percentage means darker tint.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-12 items-center mb-16">
        <div className="space-y-8">
          <div className="relative aspect-video bg-surface rounded-xl border border-border overflow-hidden flex items-center justify-center p-8">
            {/* SVG Car representation */}
            <svg viewBox="0 0 800 400" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="bg-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#87CEEB" />
                  <stop offset="100%" stopColor="#1E90FF" />
                </linearGradient>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <rect width="40" height="40" fill="none" />
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                </pattern>
              </defs>
              
              {/* Background scene to show through windows */}
              <rect x="0" y="0" width="800" height="250" fill="url(#bg-grad)" />
              <rect x="0" y="250" width="800" height="150" fill="#2d3748" />
              <rect x="0" y="0" width="800" height="400" fill="url(#grid)" />
              
              <circle cx="200" cy="100" r="40" fill="#FFD700" />
              
              {/* Car Body */}
              <path d="M 100 250 L 150 180 C 200 150, 400 140, 550 160 L 650 250 L 700 250 L 720 320 C 720 340, 700 350, 680 350 L 650 350 A 50 50 0 0 0 550 350 L 250 350 A 50 50 0 0 0 150 350 L 100 350 C 80 350, 70 340, 70 320 Z" fill="#111111" stroke="#222222" strokeWidth="4" />
              
              {/* Wheels */}
              <circle cx="200" cy="350" r="45" fill="#0A0A0A" stroke="#333" strokeWidth="5" />
              <circle cx="200" cy="350" r="25" fill="#222" />
              <circle cx="600" cy="350" r="45" fill="#0A0A0A" stroke="#333" strokeWidth="5" />
              <circle cx="600" cy="350" r="25" fill="#222" />

              {/* Windows Area (Transparent) */}
              <path d="M 180 240 L 220 180 C 250 160, 380 155, 450 165 L 530 240 Z" fill="#E2E8F0" opacity="0.3" />
              <path d="M 460 168 C 480 170, 520 200, 540 240 L 460 240 Z" fill="#E2E8F0" opacity="0.3" />
              
              {/* Tint Overlay Layers */}
              {/* Front Window */}
              <path d="M 460 168 C 480 170, 520 200, 540 240 L 460 240 Z" fill="#000000" opacity={currentOpacity * 0.8} />
              
              {/* Rear Window */}
              <path d="M 180 240 L 220 180 C 250 160, 380 155, 450 165 L 450 240 Z" fill="#000000" opacity={currentOpacity} />
              
              {/* B-Pillar */}
              <rect x="450" y="165" width="15" height="75" fill="#111111" />
            </svg>
          </div>
        </div>

        <div className="space-y-8">
          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle className="text-2xl">{vlt}% VLT Film</CardTitle>
              <CardDescription>Adjust the slider to preview different tint percentages.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="space-y-4">
                <Slider
                  defaultValue={[35]}
                  max={50}
                  min={5}
                  step={5}
                  value={[vlt]}
                  onValueChange={(val) => setVlt(val[0])}
                  className="py-4"
                />
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>5% (Limo)</span>
                  <span>15%</span>
                  <span>25%</span>
                  <span>35%</span>
                  <span>50%</span>
                </div>
              </div>

              <div className="pt-4 border-t border-border">
                <h4 className="font-semibold mb-2">Characteristics at {vlt}%:</h4>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {vlt <= 5 && (
                    <>
                      <li>• Maximum privacy ("Limo Tint")</li>
                      <li>• Excellent heat rejection</li>
                      <li>• Hardest to see out of at night</li>
                    </>
                  )}
                  {vlt > 5 && vlt <= 20 && (
                    <>
                      <li>• High privacy level</li>
                      <li>• Matches most factory rear window tints</li>
                      <li>• Great glare reduction</li>
                    </>
                  )}
                  {vlt > 20 && vlt <= 35 && (
                    <>
                      <li>• Legal limit for front windows in many areas</li>
                      <li>• Good balance of privacy and visibility</li>
                      <li>• Elegant, sleek appearance</li>
                    </>
                  )}
                  {vlt > 35 && (
                    <>
                      <li>• Light tint, highly visible interior</li>
                      <li>• Excellent nighttime visibility</li>
                      <li>• Still provides UV protection</li>
                    </>
                  )}
                </ul>
              </div>

              <div className="pt-4">
                <Link href={`/book?intent=tint&vlt=${vlt}`}>
                  <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                    Book Tinting Service
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-6">
        <Card className="bg-surface border-border">
          <CardContent className="pt-6">
            <Sun className="h-8 w-8 text-primary mb-4" />
            <h3 className="font-semibold mb-2">99% UV Rejection</h3>
            <p className="text-sm text-muted-foreground">Protects your interior from fading and your skin from harmful UV rays.</p>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardContent className="pt-6">
            <Shield className="h-8 w-8 text-primary mb-4" />
            <h3 className="font-semibold mb-2">Heat Rejection</h3>
            <p className="text-sm text-muted-foreground">Ceramic films block infrared heat, keeping your cabin significantly cooler.</p>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardContent className="pt-6">
            <Eye className="h-8 w-8 text-primary mb-4" />
            <h3 className="font-semibold mb-2">Glare Reduction</h3>
            <p className="text-sm text-muted-foreground">Reduces eye strain from sun and headlights, improving driving comfort.</p>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardContent className="pt-6">
            <Droplet className="h-8 w-8 text-primary mb-4" />
            <h3 className="font-semibold mb-2">Premium Carbon/Ceramic</h3>
            <p className="text-sm text-muted-foreground">We use advanced color-stable films that will never turn purple or bubble.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
