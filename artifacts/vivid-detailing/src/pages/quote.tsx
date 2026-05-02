import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateQuoteRequest } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { UploadCloud, CheckCircle2 } from "lucide-react";

export default function QuoteRequest() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createQuote = useCreateQuoteRequest();
  
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    year: "",
    make: "",
    model: "",
    serviceType: "paint_correction",
    notes: ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createQuote.mutateAsync({
        data: {
          customer: {
            name: formData.name,
            email: formData.email,
            phone: formData.phone
          },
          vehicle: {
            type: "car", // default
            year: parseInt(formData.year) || undefined,
            make: formData.make,
            model: formData.model
          },
          serviceType: formData.serviceType,
          notes: formData.notes,
          photoUrls: [] // Mock upload for now
        }
      });
      setSubmitted(true);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to submit quote request. Please try again or call us."
      });
    }
  };

  if (submitted) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full bg-surface border-border text-center py-8">
          <CardContent>
            <div className="mx-auto w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Request Received</h2>
            <p className="text-muted-foreground mb-8">
              Thank you! Our master detailer will review your request and contact you within 24 hours to discuss options and pricing.
            </p>
            <Button onClick={() => setLocation("/")} className="bg-primary text-primary-foreground w-full">
              Return Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background py-12">
      <div className="container max-w-3xl">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold mb-4">Request a Custom Quote</h1>
          <p className="text-muted-foreground text-lg">
            For paint correction, PPF, or bespoke detailing work, we need to understand your vehicle's specific condition and your goals.
          </p>
        </div>

        <Card className="bg-surface border-border">
          <CardHeader>
            <CardTitle>Vehicle & Project Details</CardTitle>
            <CardDescription>The more information you provide, the more accurate our initial assessment.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="font-semibold border-b border-border pb-2">Your Information</h3>
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input id="name" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" type="tel" required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-semibold border-b border-border pb-2">Vehicle Information</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="year">Year</Label>
                      <Input id="year" required value={formData.year} onChange={e => setFormData({...formData, year: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="make">Make</Label>
                      <Input id="make" required value={formData.make} onChange={e => setFormData({...formData, make: e.target.value})} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="model">Model</Label>
                    <Input id="model" required value={formData.model} onChange={e => setFormData({...formData, model: e.target.value})} />
                  </div>
                </div>
              </div>

              <div className="space-y-4 border-t border-border pt-6">
                <h3 className="font-semibold">Project Details</h3>
                <div className="space-y-2">
                  <Label>Primary Service of Interest</Label>
                  <Select value={formData.serviceType} onValueChange={v => setFormData({...formData, serviceType: v})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select service" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paint_correction">Paint Correction / Polishing</SelectItem>
                      <SelectItem value="ppf">Paint Protection Film (PPF)</SelectItem>
                      <SelectItem value="ceramic_coating">Advanced Ceramic Coating</SelectItem>
                      <SelectItem value="full_restoration">Full Restoration</SelectItem>
                      <SelectItem value="other">Other / Not Sure</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Current Condition & Goals</Label>
                  <Textarea 
                    required
                    placeholder="E.g., The paint has swirl marks from automatic car washes. I want it looking brand new again."
                    className="min-h-[120px]"
                    value={formData.notes}
                    onChange={e => setFormData({...formData, notes: e.target.value})}
                  />
                </div>

                <div className="space-y-2 pt-2">
                  <Label>Upload Photos (Optional but helpful)</Label>
                  <div className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center justify-center text-center bg-surface-2/50 cursor-pointer hover:bg-surface-2 transition-colors">
                    <UploadCloud className="h-10 w-10 text-muted-foreground mb-4" />
                    <p className="font-medium text-sm">Click to upload or drag and drop</p>
                    <p className="text-xs text-muted-foreground mt-1">SVG, PNG, JPG or GIF (max 5MB)</p>
                    <Input type="file" className="hidden" multiple accept="image/*" />
                  </div>
                </div>
              </div>

              <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-12 text-lg">
                Submit Request
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
