import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, Sparkles, Droplets, CarFront, CheckCircle2, ArrowRight, Phone, MapPin, Star } from "lucide-react";

export default function Home() {
  return (
    <div className="w-full">
      {/* Hero — dark navy with teal radial glow */}
      <section className="relative overflow-hidden bg-background pt-24 pb-32 border-b border-border">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,_hsl(191_70%_51%_/_0.12),_transparent)]" />
        <div className="container relative z-10 mx-auto px-4 md:px-6 text-center">
          <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm text-primary mb-8 backdrop-blur-sm font-medium tracking-wide">
            <Sparkles className="mr-2 h-4 w-4" />
            Summer Special: Ceramic Coating - $249 Flat
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter mb-6 text-foreground leading-tight">
            Your Vehicle<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-primary to-primary/50">Deserves the Best</span>
          </h1>
          <p className="max-w-2xl mx-auto text-lg md:text-xl text-muted-foreground mb-10">
            Premium automotive detailing in Charlottetown & Borden-Carleton, PEI. Ceramic coatings, window tinting, and paint correction done right.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/book">
              <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-8 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-lg shadow-primary/25">
                Book an Appointment
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/quote">
              <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-14 px-8 border-border hover:bg-accent hover:border-primary/40">
                Get a Free Quote
              </Button>
            </Link>
          </div>
          <div className="flex items-center justify-center gap-6 mt-10 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <MapPin size={14} className="text-primary" />
              <span>Charlottetown & Borden-Carleton</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Phone size={14} className="text-primary" />
              <span>902-267-7775</span>
            </div>
          </div>
        </div>
      </section>

      {/* Services — LIGHT section matching brand materials */}
      <section className="py-24 section-light border-b">
        <div className="container px-4 md:px-6">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold tracking-widest uppercase text-[#29B8D9] mb-3">Detailing Services</p>
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4 text-[#0A1628]">What Can We Do For You?</h2>
            <p className="text-[#4A6280] max-w-2xl mx-auto text-base">
              Select a category below to begin your booking. Prices adjust to your vehicle size automatically.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { href: "/book?intent=clean", icon: Droplets, title: "Clean", sub: "Starting at $149", desc: "Full interior & exterior detailing. Vacuum, wipe-down, windows, mats, and more." },
              { href: "/book?intent=protect", icon: Shield, title: "Protect", sub: "Starting at $249", desc: "Ceramic coatings and sealant wax for years of lasting paint defense." },
              { href: "/book?intent=tint", icon: CarFront, title: "Tint", sub: "Get a Quote", desc: "Premium ceramic window tinting with UV and heat rejection." },
              { href: "/quote", icon: Sparkles, title: "Paint & PPF", sub: "Inquire", desc: "Paint correction, swirl removal, and Paint Protection Film installation." },
            ].map(({ href, icon: Icon, title, sub, desc }) => (
              <Link key={title} href={href}>
                <div className="group h-full bg-white rounded-xl border border-[#D0DCE8] p-7 flex flex-col hover:border-[#29B8D9] hover:shadow-lg transition-all cursor-pointer">
                  <div className="h-14 w-14 rounded-full bg-[#E8F6FB] flex items-center justify-center mb-5 group-hover:bg-[#29B8D9]/20 transition-colors">
                    <Icon className="h-7 w-7 text-[#29B8D9]" />
                  </div>
                  <h3 className="text-lg font-bold text-[#0A1628] mb-1">{title}</h3>
                  <p className="text-sm font-semibold text-[#29B8D9] mb-3">{sub}</p>
                  <p className="text-sm text-[#4A6280] leading-relaxed flex-1">{desc}</p>
                  <div className="mt-5 flex items-center gap-1.5 text-sm font-semibold text-[#29B8D9] group-hover:gap-2.5 transition-all">
                    Book now <ArrowRight size={15} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Packages preview — dark navy matching brand */}
      <section className="py-24 bg-background border-b border-border">
        <div className="container px-4 md:px-6">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold tracking-widest uppercase text-primary mb-3">Interior & Exterior Packages</p>
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">Real Pricing, No Surprises</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">Every package includes a full walk-around before and after. Price adjusts to vehicle size at checkout.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { name: "Interior Refresh", price: "$149+", highlight: false, desc: "Vacuum, wipe-down, windows cleaned, mats cleaned." },
              { name: "Interior Deep Clean", price: "$199+", highlight: false, desc: "Everything in Refresh + carpet & upholstery steam, leather conditioning." },
              { name: "Vivid Luster", price: "$219+", highlight: true, desc: "Full interior + exterior hand wash, tire shine, wheel cleaning, hand wax." },
              { name: "Vivid Glow", price: "$329+", highlight: false, desc: "Ultimate package: decontamination wash, steam clean, paint sealant." },
            ].map(({ name, price, highlight, desc }) => (
              <Card key={name} className={`border transition-all ${highlight ? "border-primary/60 bg-primary/5 shadow-lg shadow-primary/10" : "border-border bg-card"}`}>
                <CardContent className="p-6">
                  {highlight && (
                    <div className="flex items-center gap-1.5 text-xs font-bold text-primary uppercase tracking-widest mb-3">
                      <Star size={12} fill="currentColor" /> Most Popular
                    </div>
                  )}
                  <h3 className="text-base font-bold mb-1">{name}</h3>
                  <p className="text-2xl font-extrabold text-primary mb-3">{price}</p>
                  <p className="text-sm text-muted-foreground mb-5 leading-relaxed">{desc}</p>
                  <Link href="/book?intent=clean">
                    <Button size="sm" variant={highlight ? "default" : "outline"} className={`w-full ${highlight ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`}>
                      Book This
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="text-center mt-8">
            <Link href="/book">
              <Button variant="outline" className="border-border hover:border-primary/40 hover:bg-accent">
                See All Services & Add-Ons <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Trust — LIGHT section */}
      <section className="py-20 section-light border-b">
        <div className="container px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 text-center">
            {[
              { icon: CheckCircle2, title: "Premium Products Only", body: "We use industry-leading chemicals and tools. No shortcuts, no compromise on your paint or interior." },
              { icon: Shield, title: "Fully Insured", body: "Your vehicle is covered under comprehensive garage keepers liability insurance throughout your appointment." },
              { icon: Sparkles, title: "Trained Technicians", body: "Continuous education in the latest detailing techniques: ceramic application, tint installation, PPF." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="space-y-4">
                <div className="mx-auto w-14 h-14 flex items-center justify-center rounded-full bg-[#E8F6FB] border border-[#C0DFF0]">
                  <Icon className="h-6 w-6 text-[#29B8D9]" />
                </div>
                <h3 className="text-lg font-bold text-[#0A1628]">{title}</h3>
                <p className="text-[#4A6280] text-sm leading-relaxed max-w-xs mx-auto">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA — dark with teal */}
      <section className="py-20 bg-background">
        <div className="container px-4 md:px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold mb-4">Ready to Book?</h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">Takes under 3 minutes. Pick your service, select add-ons, and lock in your time slot.</p>
          <Link href="/book">
            <Button size="lg" className="h-14 px-10 text-lg font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25">
              Start Booking
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
          <p className="text-xs text-muted-foreground mt-4">
            Or call us directly: <a href="tel:9022677775" className="text-primary font-medium hover:underline">902-267-7775</a>
          </p>
        </div>
      </section>

      {/* Sticky mobile CTA */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 p-4 bg-card/95 backdrop-blur border-t border-border z-40">
        <Link href="/book">
          <Button className="w-full h-12 text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20">
            Book Appointment
          </Button>
        </Link>
      </div>
    </div>
  );
}
