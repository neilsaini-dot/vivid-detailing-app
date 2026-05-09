import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { InspectionFlow } from "@/components/InspectionFlow";
import { Loader2 } from "lucide-react";

export default function InspectionPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const [, navigate] = useLocation();

  const isAuthenticated =
    typeof sessionStorage !== "undefined" &&
    sessionStorage.getItem("adminAuth") === "true";

  const [booking, setBooking] = useState<any | null>(null);
  const [inspection, setInspection] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) { navigate("/admin"); return; }
    if (!bookingId) return;

    setLoading(true);
    Promise.all([
      fetch(`/api/admin/bookings/${bookingId}`).then((r) =>
        r.ok ? r.json() : Promise.reject("Booking not found")
      ),
      fetch(`/api/admin/inspections/booking/${bookingId}`).then((r) =>
        r.ok ? r.json() : null
      ),
    ])
      .then(([b, insp]) => {
        setBooking(b);
        setInspection(insp);
        setLoading(false);
      })
      .catch((err) => {
        setError(typeof err === "string" ? err : "Failed to load inspection");
        setLoading(false);
      });
  }, [bookingId, isAuthenticated]);

  const goBack = () => navigate("/admin");

  if (!isAuthenticated) return null;

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Loading inspection…</span>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-4 text-center px-4">
        <p className="text-destructive font-medium">{error ?? "Booking not found"}</p>
        <button
          onClick={goBack}
          className="text-sm underline text-muted-foreground hover:text-foreground"
        >
          Back to Admin
        </button>
      </div>
    );
  }

  return (
    <InspectionFlow
      booking={booking}
      inspection={inspection}
      onClose={goBack}
      onComplete={goBack}
    />
  );
}
