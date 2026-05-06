import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ReviewPage() {
  const params = new URLSearchParams(window.location.search);
  const bookingId = params.get("booking_id") ?? "";
  const initialRating = Math.min(5, Math.max(1, parseInt(params.get("rating") ?? "5", 10)));

  const [rating, setRating] = useState(initialRating);
  const [hovered, setHovered] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [isHighRating, setIsHighRating] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(2);
  const { toast } = useToast();

  // Check for existing review on mount
  useEffect(() => {
    if (!bookingId) return;
    fetch(`/api/reviews/check?bookingId=${encodeURIComponent(bookingId)}`)
      .then(r => r.json())
      .then(d => { if (d.exists) setAlreadySubmitted(true); })
      .catch(() => {});
  }, [bookingId]);

  // Countdown before Google redirect
  useEffect(() => {
    if (!submitted || !isHighRating || !redirectUrl) return;
    if (countdown <= 0) {
      window.location.href = redirectUrl;
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [submitted, isHighRating, redirectUrl, countdown]);

  const handleSubmit = async () => {
    if (!bookingId) {
      toast({ variant: "destructive", title: "Invalid link", description: "This review link is missing a booking ID." });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, rating, feedback: feedback || null }),
      });
      const data = await res.json();
      if (data.alreadySubmitted) {
        setAlreadySubmitted(true);
        return;
      }
      setIsHighRating(rating >= 4);
      setRedirectUrl(data.redirectUrl ?? null);
      setSubmitted(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to submit", description: "Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  if (alreadySubmitted) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <Card className="bg-surface border-border max-w-md w-full">
          <CardContent className="p-10 text-center">
            <div className="text-5xl mb-4">⭐</div>
            <h2 className="text-xl font-bold mb-3">Already Submitted</h2>
            <p className="text-muted-foreground">
              You've already submitted a review for this visit. Thank you!
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <Card className="bg-surface border-border max-w-md w-full">
          <CardContent className="p-10 text-center">
            <div className="text-5xl mb-5">{isHighRating ? "🌟" : "💙"}</div>
            <h2 className="text-xl font-bold mb-3 leading-snug">
              {isHighRating
                ? "Thank you! We're so glad you loved your experience."
                : "Thank you for your honest feedback."}
            </h2>
            {!isHighRating && (
              <p className="text-muted-foreground text-sm">
                We take every comment seriously and will use this to improve.
              </p>
            )}
            {isHighRating && redirectUrl && (
              <p className="text-muted-foreground text-sm mt-2">
                Redirecting you to Google in {countdown} second{countdown !== 1 ? "s" : ""}…
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full">
        <div className="text-center mb-8">
          <p className="text-muted-foreground text-sm mt-1">How was your recent visit?</p>
        </div>

        <Card className="bg-surface border-border">
          <CardContent className="p-8">
            <h2 className="text-2xl font-bold text-center mb-1">Rate Your Experience</h2>
            <p className="text-muted-foreground text-center text-sm mb-8">
              Your feedback means the world to us.
            </p>

            {/* Star selector */}
            <div className="flex justify-center gap-3 mb-8">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHovered(star)}
                  onMouseLeave={() => setHovered(0)}
                  className="transition-transform hover:scale-110 focus:outline-none"
                  aria-label={`${star} star${star !== 1 ? "s" : ""}`}
                >
                  <Star
                    className={`h-12 w-12 transition-colors ${
                      (hovered || rating) >= star
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-muted-foreground/40"
                    }`}
                  />
                </button>
              ))}
            </div>

            {/* Rating label */}
            <p className="text-center text-sm font-medium text-muted-foreground mb-6">
              {["", "Poor", "Fair", "Good", "Great", "Excellent!"][hovered || rating]}
            </p>

            <Textarea
              placeholder="Tell us more about your experience (optional)"
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              className="bg-background border-border min-h-[120px] mb-6 resize-none"
            />

            <Button
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-12 text-base font-semibold"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "Submitting…" : "Submit My Review"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
