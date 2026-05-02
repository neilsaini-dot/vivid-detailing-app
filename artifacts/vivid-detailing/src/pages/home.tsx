import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, Sparkles, Droplets, CarFront, CheckCircle2, ArrowRight } from "lucide-react";
import { useListFeaturedServices } from "@workspace/api-client-react";

export default function Home() {
  const { data: featuredServices, isLoading } = useListFeaturedServices();

  return (
    <div className="w-full">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-background pt-24 pb-32 border-b border-border">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
        <div className="container relative z-10 mx-auto px-4 md:px-6 text-center">
          <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm text-primary mb-8 backdrop-blur-sm">
            <Sparkles className="mr-2 h-4 w-4" />
            Summer Special: Ceramic Coating $249 Flat
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter mb-6 text-foreground">
            Precision <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-primary/60">Automotive</span><br />
            Appearance
          </h1>
          <p className="max-w-2xl mx-auto text-lg md:text-xl text-muted-foreground mb-10">
            Every booking feels like checking into a luxury garage. Dark, technical, and confident. Elevate your vehicle's aesthetic.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/book">
              <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-8 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                Book Now
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/quote">
              <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-14 px-8 border-border hover:bg-surface-2">
                Request Quote
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Services Category Cards */}
      <section className="py-24 bg-card">
        <div className="container px-4 md:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Our Expertise</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Select a service category to begin your booking journey.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Link href="/book?intent=clean">
              <Card className="h-full bg-surface hover:bg-surface-2 border-border transition-all cursor-pointer group hover:border-primary/50 overflow-hidden">
                <CardContent className="p-8 flex flex-col items-center text-center">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Droplets className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Clean</h3>
                  <p className="text-sm text-muted-foreground">Deep interior & exterior detailing for a pristine finish.</p>
                </CardContent>
              </Card>
            </Link>

            <Link href="/book?intent=protect">
              <Card className="h-full bg-surface hover:bg-surface-2 border-border transition-all cursor-pointer group hover:border-primary/50 overflow-hidden">
                <CardContent className="p-8 flex flex-col items-center text-center">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Shield className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Protect</h3>
                  <p className="text-sm text-muted-foreground">Ceramic coatings and sealants for lasting defense.</p>
                </CardContent>
              </Card>
            </Link>

            <Link href="/book?intent=tint">
              <Card className="h-full bg-surface hover:bg-surface-2 border-border transition-all cursor-pointer group hover:border-primary/50 overflow-hidden">
                <CardContent className="p-8 flex flex-col items-center text-center">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <CarFront className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Tint</h3>
                  <p className="text-sm text-muted-foreground">Premium carbon and ceramic window tinting films.</p>
                </CardContent>
              </Card>
            </Link>

            <Link href="/quote">
              <Card className="h-full bg-surface hover:bg-surface-2 border-border transition-all cursor-pointer group hover:border-primary/50 overflow-hidden">
                <CardContent className="p-8 flex flex-col items-center text-center">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Sparkles className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Improve Paint</h3>
                  <p className="text-sm text-muted-foreground">Paint correction and Paint Protection Film (PPF).</p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      </section>

      {/* Trust Indicators */}
      <section className="py-24 bg-background border-t border-border">
        <div className="container px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 text-center">
            <div className="space-y-4">
              <div className="mx-auto w-12 h-12 flex items-center justify-center rounded-full bg-surface border border-border text-primary">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold">Premium Products</h3>
              <p className="text-muted-foreground text-sm">We use only industry-leading chemicals and tools to ensure the highest quality results without compromise.</p>
            </div>
            <div className="space-y-4">
              <div className="mx-auto w-12 h-12 flex items-center justify-center rounded-full bg-surface border border-border text-primary">
                <Shield className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold">Fully Insured</h3>
              <p className="text-muted-foreground text-sm">Your vehicle is protected under our comprehensive garage keepers liability insurance policy.</p>
            </div>
            <div className="space-y-4">
              <div className="mx-auto w-12 h-12 flex items-center justify-center rounded-full bg-surface border border-border text-primary">
                <Sparkles className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold">Expert Technicians</h3>
              <p className="text-muted-foreground text-sm">Our team undergoes continuous training to master the latest techniques in automotive detailing.</p>
            </div>
          </div>
        </div>
      </section>
      
      {/* Sticky Book CTA for Mobile */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 p-4 bg-card/95 backdrop-blur border-t border-border z-40">
        <Link href="/book">
          <Button className="w-full h-12 text-lg font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20">
            Book Appointment
          </Button>
        </Link>
      </div>
    </div>
  );
}
