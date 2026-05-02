import { Link, useLocation } from "wouter";
import { MapPin, Phone, Mail } from "lucide-react";

export function Footer() {
  const [location] = useLocation();
  const isBooking = location === "/book";

  return (
    <footer className="border-t border-border bg-card py-12 md:py-16">
      <div className={`container grid gap-8 ${isBooking ? "md:grid-cols-2" : "md:grid-cols-4"}`}>
        {!isBooking && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Vivid Detailing" className="h-10 w-10 object-contain" />
              <span className="font-bold text-lg tracking-tight">Vivid Detailing</span>
            </div>
            <p className="text-sm text-muted-foreground max-w-xs">
              Precision automotive appearance shop in Charlottetown. Dark, technical, confident.
            </p>
          </div>
        )}
        {!isBooking && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Services</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/book?intent=clean" className="hover:text-primary">Interior & Exterior Cleaning</Link></li>
              <li><Link href="/book?intent=protect" className="hover:text-primary">Ceramic Coating</Link></li>
              <li><Link href="/book?intent=tint" className="hover:text-primary">Window Tinting</Link></li>
              <li><Link href="/quote" className="hover:text-primary">Paint Correction & PPF</Link></li>
            </ul>
          </div>
        )}
        {!isBooking && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Company</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/dashboard" className="hover:text-primary">Customer Dashboard</Link></li>
              <li><Link href="/tint-visualizer" className="hover:text-primary">Tint Visualizer</Link></li>
              <li><Link href="/admin" className="hover:text-primary">Admin Portal</Link></li>
            </ul>
          </div>
        )}
        <div className="space-y-4">
          <h3 className="text-sm font-medium">Contact</h3>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <MapPin size={16} className="text-primary shrink-0 mt-0.5" />
              <span>{import.meta.env.VITE_BUSINESS_ADDRESS || "2-70 Nicholas Lane, Charlottetown, PE"}</span>
            </li>
            <li className="flex items-center gap-2">
              <Phone size={16} className="text-primary shrink-0" />
              <span>{import.meta.env.VITE_BUSINESS_PHONE || "902-267-7775"}</span>
            </li>
            <li className="flex items-center gap-2">
              <Mail size={16} className="text-primary shrink-0" />
              <span>{import.meta.env.VITE_BUSINESS_EMAIL || "contact@vividpei.com"}</span>
            </li>
          </ul>
        </div>
      </div>
      <div className="container mt-12 pt-8 border-t border-border flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} Vivid Detailing. All rights reserved.</p>
        {!isBooking && (
          <div className="flex items-center gap-4">
            <span>Terms of Service</span>
            <span>Privacy Policy</span>
          </div>
        )}
      </div>
    </footer>
  );
}
