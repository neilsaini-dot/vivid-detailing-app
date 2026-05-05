import { Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [location] = useLocation();
  const isBooking = location === "/book";
  const isDashboard = location === "/dashboard";
  const isAdmin = location === "/admin";
  const isSimple = isBooking || isDashboard || isAdmin;

  if (isAdmin) {
    return (
      <nav className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Vivid Detailing" className="h-10 w-10 object-contain" />
            <span className="font-bold text-lg tracking-tight">Vivid Detailing</span>
          </div>
        </div>
      </nav>
    );
  }

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Vivid Detailing" className="h-10 w-10 object-contain" />
            <span className="font-bold text-lg tracking-tight hidden sm:block">Vivid Detailing</span>
          </div>
          {!isSimple && (
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
              <Link href="/book" className="transition-colors hover:text-primary">Services</Link>
              <Link href="/tint-visualizer" className="transition-colors hover:text-primary">Tint Visualizer</Link>
              <Link href="/quote" className="transition-colors hover:text-primary">Get a Quote</Link>
            </nav>
          )}
        </div>
        {!isBooking && (
          <>
            <div className="hidden md:flex items-center gap-4">
              {!isDashboard && (
                <Link href="/dashboard" className="text-sm font-medium text-muted-foreground hover:text-primary">
                  Dashboard
                </Link>
              )}
              {!isDashboard && (
                <Link href="/book">
                  <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                    Book Now
                  </Button>
                </Link>
              )}
              {isDashboard && (
                <Link href="/book">
                  <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                    Book New Service
                  </Button>
                </Link>
              )}
            </div>
            <button
              className="md:hidden p-2 text-muted-foreground"
              onClick={() => setIsOpen(!isOpen)}
            >
              {isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </>
        )}
      </div>
      {!isSimple && isOpen && (
        <div className="md:hidden border-b border-border bg-background px-4 py-4 space-y-4">
          <Link href="/book" className="block text-sm font-medium hover:text-primary">Services</Link>
          <Link href="/tint-visualizer" className="block text-sm font-medium hover:text-primary">Tint Visualizer</Link>
          <Link href="/quote" className="block text-sm font-medium hover:text-primary">Get a Quote</Link>
          <Link href="/dashboard" className="block text-sm font-medium hover:text-primary">Dashboard</Link>
          <Link href="/book" className="block">
            <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
              Book Now
            </Button>
          </Link>
        </div>
      )}
      {isDashboard && isOpen && (
        <div className="md:hidden border-b border-border bg-background px-4 py-4 space-y-4">
          <Link href="/book" className="block">
            <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
              Book New Service
            </Button>
          </Link>
        </div>
      )}
    </nav>
  );
}
