import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { 
  CarFront, Truck, Activity, Droplet, Sun, Shield, Settings, 
  ChevronRight, ArrowLeft, Plus, Check, CalendarIcon, Info
} from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

import { 
  useListServices, useListAddOns, useCalculatePrice, useCreateBooking,
  PriceCalculateBodyVehicleType, CreateVehicleBodyType
} from "@workspace/api-client-react";

// Types
type VehicleType = "car" | "suv" | "truck" | "van";
type Intent = "clean" | "protect" | "tint" | "paint" | "quote";

interface BookingState {
  vehicle: {
    type: VehicleType;
    year: string;
    make: string;
    model: string;
    colour: string;
    licensePlate: string;
  };
  intent?: Intent;
  serviceIds: string[];
  addOnIds: string[];
  promoIds: string[];
  appointmentAt?: Date;
  timeSlot?: string;
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  notes: string;
  depositPaid: boolean;
}

const initialBookingState: BookingState = {
  vehicle: { type: "car", year: "", make: "", model: "", colour: "", licensePlate: "" },
  serviceIds: [],
  addOnIds: [],
  promoIds: [],
  customer: { name: "", email: "", phone: "" },
  notes: "",
  depositPaid: false
};

const STEPS = 8;
const TIME_SLOTS = ["08:00", "10:00", "12:00", "14:00", "16:00"];

export default function BookingFlow() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [step, setStep] = useState(1);
  const [state, setState] = useState<BookingState>(initialBookingState);
  
  // API Hooks
  const { data: services = [] } = useListServices({ category: state.intent === "protect" ? "Protection" : state.intent === "clean" ? "Detailing" : state.intent === "tint" ? "Tint" : undefined });
  const { data: addOns = [] } = useListAddOns({ vehicleType: state.vehicle.type as any });
  const calculatePrice = useCalculatePrice();
  const createBooking = useCreateBooking();
  
  // Sync URL params for intent if present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const intentParam = params.get("intent") as Intent;
    if (intentParam && ["clean", "protect", "tint", "paint", "quote"].includes(intentParam)) {
      setState(s => ({ ...s, intent: intentParam }));
      if (step === 1) setStep(2);
    }
  }, []);

  const handleNext = () => setStep(s => Math.min(s + 1, STEPS));
  const handleBack = () => setStep(s => Math.max(s - 1, 1));
  
  const updateVehicle = (data: Partial<BookingState["vehicle"]>) => 
    setState(s => ({ ...s, vehicle: { ...s.vehicle, ...data } }));

  // Dynamic Pricing
  const { data: pricing } = useCalculatePrice().mutateAsync; // Actually we should use useEffect to call it
  const [currentPricing, setCurrentPricing] = useState<any>(null);

  useEffect(() => {
    if (state.serviceIds.length > 0 || state.addOnIds.length > 0) {
      calculatePrice.mutate({
        data: {
          vehicleType: state.vehicle.type as PriceCalculateBodyVehicleType,
          serviceIds: state.serviceIds,
          addOnIds: state.addOnIds
        }
      }, {
        onSuccess: (data) => setCurrentPricing(data)
      });
    } else {
      setCurrentPricing(null);
    }
  }, [state.vehicle.type, state.serviceIds, state.addOnIds]);

  const handleSubmit = async () => {
    try {
      const dt = state.appointmentAt;
      let appointmentIso = undefined;
      if (dt && state.timeSlot) {
        const [hours, minutes] = state.timeSlot.split(":");
        dt.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        appointmentIso = dt.toISOString();
      }

      await createBooking.mutateAsync({
        data: {
          customer: state.customer,
          vehicle: {
            type: state.vehicle.type as CreateVehicleBodyType,
            year: state.vehicle.year ? parseInt(state.vehicle.year) : undefined,
            make: state.vehicle.make,
            model: state.vehicle.model,
            colour: state.vehicle.colour,
            licensePlate: state.vehicle.licensePlate
          },
          serviceIds: state.serviceIds,
          addOnIds: state.addOnIds,
          promoIds: state.promoIds,
          appointmentAt: appointmentIso,
          notes: state.notes,
          totalEstimate: currentPricing?.total
        }
      });
      
      toast({
        title: "Booking Confirmed",
        description: "Your appointment has been scheduled.",
      });
      handleNext(); // Go to step 8
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create booking. Please try again.",
      });
    }
  };

  const slideVariants = {
    enter: (direction: number) => ({ x: direction > 0 ? 1000 : -1000, opacity: 0 }),
    center: { x: 0, opacity: 1, zIndex: 1 },
    exit: (direction: number) => ({ x: direction < 0 ? 1000 : -1000, opacity: 0, zIndex: 0 })
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background flex flex-col md:flex-row">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full px-4 py-8 relative">
        <div className="mb-8">
          <Progress value={(step / STEPS) * 100} className="h-2" />
          <p className="text-sm text-muted-foreground mt-2 font-medium">Step {step} of {STEPS}</p>
        </div>

        <div className="flex-1 relative">
          <AnimatePresence mode="wait" custom={1}>
            <motion.div
              key={step}
              custom={1}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ x: { type: "spring", stiffness: 300, damping: 30 }, opacity: { duration: 0.2 } }}
              className="w-full absolute"
            >
              {step === 1 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Tell us about your vehicle</h2>
                    <p className="text-muted-foreground">Select your vehicle type to ensure accurate pricing.</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    {([
                      { type: "car" as VehicleType, label: "Car" },
                      { type: "suv" as VehicleType, label: "SUV" },
                      { type: "truck" as VehicleType, label: "Truck" },
                      { type: "van" as VehicleType, label: "Van" },
                    ]).map(({ type: t, label }) => (
                      <Card 
                        key={t}
                        className={`cursor-pointer transition-all ${state.vehicle.type === t ? 'border-primary bg-primary/5' : 'hover:border-primary/50'}`}
                        onClick={() => updateVehicle({ type: t })}
                      >
                        <CardContent className="flex flex-col items-center justify-center p-6 gap-3">
                          {t === 'car' && <CarFront size={40} className={state.vehicle.type === t ? "text-primary" : "text-muted-foreground"} />}
                          {t === 'suv' && <CarFront size={40} className={state.vehicle.type === t ? "text-primary" : "text-muted-foreground"} />}
                          {t === 'truck' && <Truck size={40} className={state.vehicle.type === t ? "text-primary" : "text-muted-foreground"} />}
                          {t === 'van' && <Truck size={40} className={state.vehicle.type === t ? "text-primary" : "text-muted-foreground"} />}
                          <span className="font-semibold">{label}</span>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-4">
                    <div className="space-y-2">
                      <Label>Year</Label>
                      <Input value={state.vehicle.year} onChange={e => updateVehicle({ year: e.target.value })} placeholder="2023" />
                    </div>
                    <div className="space-y-2">
                      <Label>Make</Label>
                      <Input value={state.vehicle.make} onChange={e => updateVehicle({ make: e.target.value })} placeholder="Porsche" />
                    </div>
                    <div className="space-y-2">
                      <Label>Model</Label>
                      <Input value={state.vehicle.model} onChange={e => updateVehicle({ model: e.target.value })} placeholder="911" />
                    </div>
                    <div className="space-y-2">
                      <Label>Colour</Label>
                      <Input value={state.vehicle.colour} onChange={e => updateVehicle({ colour: e.target.value })} placeholder="Black" />
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label>License Plate (Optional)</Label>
                      <Input value={state.vehicle.licensePlate} onChange={e => updateVehicle({ licensePlate: e.target.value })} placeholder="XYZ 123" />
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">What brings you in?</h2>
                    <p className="text-muted-foreground">Select your primary goal to see recommended services.</p>
                  </div>
                  
                  <div className="grid gap-4">
                    {[
                      { id: "clean", title: "Clean my vehicle", desc: "Interior & exterior detailing packages", icon: Droplet },
                      { id: "protect", title: "Protect my vehicle", desc: "Ceramic coatings & sealants", icon: Shield },
                      { id: "tint", title: "Tint my windows", desc: "Carbon and ceramic window films", icon: Sun },
                      { id: "paint", title: "Improve paint/gloss", desc: "Paint correction & polishing", icon: Settings }
                    ].map((intent) => (
                      <Card 
                        key={intent.id}
                        className={`cursor-pointer transition-all ${state.intent === intent.id ? 'border-primary bg-primary/5' : 'hover:border-primary/50'}`}
                        onClick={() => setState(s => ({ ...s, intent: intent.id as Intent }))}
                      >
                        <CardContent className="flex items-center p-4 gap-4">
                          <div className={`p-3 rounded-full ${state.intent === intent.id ? 'bg-primary/20' : 'bg-surface-2'}`}>
                            <intent.icon size={24} className={state.intent === intent.id ? "text-primary" : "text-muted-foreground"} />
                          </div>
                          <div>
                            <h3 className="font-semibold">{intent.title}</h3>
                            <p className="text-sm text-muted-foreground">{intent.desc}</p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    <Card 
                      className="cursor-pointer hover:border-primary/50 transition-all border-dashed"
                      onClick={() => setLocation("/quote")}
                    >
                      <CardContent className="flex items-center justify-between p-4">
                        <div>
                          <h3 className="font-semibold">Request a Custom Quote</h3>
                          <p className="text-sm text-muted-foreground">For PPF or specialized work</p>
                        </div>
                        <ChevronRight className="text-muted-foreground" />
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Recommended Services</h2>
                    <p className="text-muted-foreground">Select one or more base services.</p>
                  </div>
                  
                  {state.intent === "protect" && (
                    <Card className="border-primary bg-primary/5 relative overflow-hidden mb-6">
                      <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-bl-lg">
                        SUMMER SPECIAL
                      </div>
                      <CardContent className="p-6">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="text-xl font-bold text-primary">Summer Special Ceramic</h3>
                          <span className="text-lg font-bold text-primary">$249</span>
                        </div>
                        <p className="text-sm text-muted-foreground mb-4">1-year ceramic coating applied to all painted surfaces.</p>
                        <Button 
                          variant={state.promoIds.includes("summer-special") ? "default" : "outline"}
                          className="w-full"
                          onClick={() => setState(s => ({
                            ...s, 
                            promoIds: s.promoIds.includes("summer-special") ? [] : ["summer-special"]
                          }))}
                        >
                          {state.promoIds.includes("summer-special") ? (
                            <><Check className="mr-2 h-4 w-4" /> Selected</>
                          ) : "Select Special"}
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  <div className="grid gap-4">
                    {services.map((svc) => (
                      <Card 
                        key={svc.id}
                        className={`transition-all ${state.serviceIds.includes(svc.id) ? 'border-primary bg-primary/5' : ''}`}
                      >
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <h3 className="font-bold text-primary">{svc.name}</h3>
                              <p className="text-sm text-muted-foreground mt-1">{svc.description}</p>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-primary">
                                ${svc.prices.find(p => p.vehicleType === state.vehicle.type)?.price || svc.basePrice}
                              </span>
                            </div>
                          </div>
                          <div className="mt-4 flex justify-between items-center">
                            <Button variant="link" className="p-0 h-auto text-xs" onClick={() => {}}>View details</Button>
                            <Button 
                              size="sm" 
                              variant={state.serviceIds.includes(svc.id) ? "default" : "outline"}
                              onClick={() => {
                                setState(s => ({
                                  ...s,
                                  serviceIds: s.serviceIds.includes(svc.id) 
                                    ? s.serviceIds.filter(id => id !== svc.id)
                                    : [...s.serviceIds, svc.id]
                                }))
                              }}
                            >
                              {state.serviceIds.includes(svc.id) ? "Selected" : "Select"}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {services.length === 0 && <p className="text-center text-muted-foreground py-8">No services found for this category.</p>}
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Enhance Your Package</h2>
                    <p className="text-muted-foreground">Select optional add-ons for your vehicle.</p>
                  </div>
                  
                  <div className="space-y-6">
                    {['Interior', 'Exterior'].map(group => {
                      const groupAddOns = addOns.filter(a => a.categoryGroup === group);
                      if (groupAddOns.length === 0) return null;
                      
                      return (
                        <div key={group}>
                          <h3 className="text-lg font-semibold mb-3 border-b border-border pb-2">{group} Upgrades</h3>
                          <div className="grid gap-3">
                            {groupAddOns.map(addon => (
                              <label key={addon.id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-primary/50 cursor-pointer">
                                <div className="flex items-center gap-3">
                                  <Checkbox 
                                    checked={state.addOnIds.includes(addon.id)}
                                    onCheckedChange={(checked) => {
                                      setState(s => ({
                                        ...s,
                                        addOnIds: checked 
                                          ? [...s.addOnIds, addon.id]
                                          : s.addOnIds.filter(id => id !== addon.id)
                                      }))
                                    }}
                                  />
                                  <span className="font-medium text-sm">{addon.name}</span>
                                </div>
                                <span className="text-sm font-semibold text-primary">
                                  +${addon.prices.find(p => p.vehicleType === state.vehicle.type)?.price || 0}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {step === 5 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Smart Recommendations</h2>
                    <p className="text-muted-foreground">Based on your selection, you might also need these.</p>
                  </div>
                  
                  <div className="grid gap-4">
                    {addOns.slice(0, 2).map(addon => ( // Mocking smart recommendations
                      <Card key={addon.id} className="border-primary/50 bg-primary/5">
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                          <CardTitle className="text-base">{addon.name}</CardTitle>
                          <Badge variant="secondary" className="bg-primary/20 text-primary">Recommended</Badge>
                        </CardHeader>
                        <CardContent>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Highly suggested for {state.vehicle.type}s.</span>
                            <div className="flex items-center gap-4">
                              <span className="font-bold text-primary">+${addon.prices.find(p => p.vehicleType === state.vehicle.type)?.price || 0}</span>
                              <Button 
                                size="sm"
                                variant={state.addOnIds.includes(addon.id) ? "default" : "outline"}
                                onClick={() => {
                                  setState(s => ({
                                    ...s,
                                    addOnIds: s.addOnIds.includes(addon.id) 
                                      ? s.addOnIds.filter(id => id !== addon.id)
                                      : [...s.addOnIds, addon.id]
                                  }))
                                }}
                              >
                                {state.addOnIds.includes(addon.id) ? "Remove" : "Add"}
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {step === 6 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Review Estimate</h2>
                    <p className="text-muted-foreground">Please review your selected services and total.</p>
                  </div>
                  
                  <Card className="bg-surface border-border">
                    <CardContent className="p-6 space-y-4">
                      <div className="space-y-2">
                        <h3 className="font-semibold text-lg border-b border-border pb-2 mb-4">Line Items</h3>
                        {currentPricing?.lineItems.map((item: any, i: number) => (
                          <div key={i} className="flex justify-between text-sm">
                            <span>{item.name} {item.isQuoteBased && <Badge variant="outline" className="ml-2 text-[10px]">Quote</Badge>}</span>
                            <span>{item.isQuoteBased ? "TBD" : `$${item.price?.toFixed(2)}`}</span>
                          </div>
                        ))}
                        {currentPricing?.lineItems.length === 0 && <p className="text-sm text-muted-foreground">No items selected.</p>}
                      </div>
                      
                      <div className="border-t border-border pt-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Subtotal</span>
                          <span>${currentPricing?.subtotal?.toFixed(2) || "0.00"}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">HST (15%)</span>
                          <span>${currentPricing?.tax?.toFixed(2) || "0.00"}</span>
                        </div>
                        <div className="flex justify-between font-bold text-lg pt-2 border-t border-border mt-2">
                          <span>Total</span>
                          <span className="text-primary">${currentPricing?.total?.toFixed(2) || "0.00"}</span>
                        </div>
                      </div>

                      {currentPricing?.hasQuoteItems && (
                        <div className="bg-surface-2 p-3 rounded-md flex items-start gap-2 mt-4">
                          <Info size={16} className="text-primary mt-0.5 shrink-0" />
                          <p className="text-xs text-muted-foreground">Your booking contains quote-based items. The final price will be determined after vehicle inspection.</p>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-4 mt-4 border-t border-border">
                        <div className="space-y-0.5">
                          <Label>Pay 20% deposit now</Label>
                          <p className="text-xs text-muted-foreground">Secure your appointment instantly</p>
                        </div>
                        <Switch 
                          checked={state.depositPaid}
                          onCheckedChange={(c) => setState(s => ({ ...s, depositPaid: c }))}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {step === 7 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Final Details</h2>
                    <p className="text-muted-foreground">Choose a time and enter your information.</p>
                  </div>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <Label>Appointment Date</Label>
                      <Card className="p-2 border-border bg-surface">
                        <Calendar
                          mode="single"
                          selected={state.appointmentAt}
                          onSelect={(d) => setState(s => ({ ...s, appointmentAt: d }))}
                          disabled={(date) => date < new Date()}
                          className="rounded-md"
                        />
                      </Card>
                    </div>
                    
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <Label>Time Slot</Label>
                        <Select value={state.timeSlot} onValueChange={(v) => setState(s => ({ ...s, timeSlot: v }))}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a time" />
                          </SelectTrigger>
                          <SelectContent>
                            {TIME_SLOTS.map(t => (
                              <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Full Name</Label>
                          <Input value={state.customer.name} onChange={e => setState(s => ({ ...s, customer: { ...s.customer, name: e.target.value } }))} placeholder="John Doe" />
                        </div>
                        <div className="space-y-2">
                          <Label>Email</Label>
                          <Input type="email" value={state.customer.email} onChange={e => setState(s => ({ ...s, customer: { ...s.customer, email: e.target.value } }))} placeholder="john@example.com" />
                        </div>
                        <div className="space-y-2">
                          <Label>Phone</Label>
                          <Input type="tel" value={state.customer.phone} onChange={e => setState(s => ({ ...s, customer: { ...s.customer, phone: e.target.value } }))} placeholder="902-555-1234" />
                        </div>
                        <div className="space-y-2">
                          <Label>Notes (Optional)</Label>
                          <Textarea value={state.notes} onChange={e => setState(s => ({ ...s, notes: e.target.value }))} placeholder="Any specific concerns?" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {step === 8 && (
                <div className="space-y-6 text-center py-12">
                  <div className="mx-auto w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mb-6">
                    <Check className="w-10 h-10 text-primary" />
                  </div>
                  <h2 className="text-4xl font-bold mb-2">Booking Confirmed</h2>
                  <p className="text-muted-foreground max-w-md mx-auto mb-8">
                    Your appointment is set. We've sent a confirmation email with preparation instructions.
                  </p>
                  
                  <div className="max-w-sm mx-auto space-y-4">
                    <Button variant="outline" className="w-full" onClick={() => {}}>
                      <CalendarIcon className="mr-2 h-4 w-4" /> Add to Calendar
                    </Button>
                    <Button className="w-full bg-primary text-primary-foreground" onClick={() => setLocation("/dashboard")}>
                      View Dashboard
                    </Button>
                  </div>
                  
                  <div className="mt-12 p-6 bg-surface border border-border rounded-xl max-w-md mx-auto">
                    <h3 className="font-semibold mb-2">Create an Account</h3>
                    <p className="text-sm text-muted-foreground mb-4">Track your service history and earn loyalty rewards.</p>
                    <Button variant="secondary" className="w-full">Send Magic Link</Button>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation Buttons */}
        {step < 8 && (
          <div className="flex justify-between items-center mt-12 pt-6 border-t border-border">
            <Button 
              variant="ghost" 
              onClick={handleBack} 
              disabled={step === 1}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            
            <Button 
              className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 px-8" 
              onClick={step === 7 ? handleSubmit : handleNext}
              disabled={
                (step === 1 && !state.vehicle.type) ||
                (step === 2 && !state.intent) ||
                (step === 3 && state.serviceIds.length === 0 && state.promoIds.length === 0 && state.intent !== 'quote') ||
                (step === 7 && (!state.appointmentAt || !state.timeSlot || !state.customer.name || !state.customer.email))
              }
            >
              {step === 7 ? "Confirm Booking" : "Continue"} <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Desktop Sidebar Summary */}
      {step > 2 && step < 8 && (
        <div className="hidden md:block w-80 border-l border-border bg-surface p-6">
          <div className="sticky top-24">
            <h3 className="text-lg font-bold mb-4 border-b border-border pb-2">Order Summary</h3>
            
            <div className="space-y-4 mb-6">
              <div className="text-sm">
                <p className="text-muted-foreground">Vehicle</p>
                <p className="font-medium capitalize">{state.vehicle.year} {state.vehicle.make} {state.vehicle.model} ({state.vehicle.type})</p>
              </div>
            </div>

            <div className="space-y-2 mb-6">
              {currentPricing?.lineItems.map((item: any, i: number) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-muted-foreground truncate pr-2">{item.name}</span>
                  <span>{item.isQuoteBased ? "TBD" : `$${item.price?.toFixed(2)}`}</span>
                </div>
              ))}
            </div>

            <div className="border-t border-border pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>${currentPricing?.subtotal?.toFixed(2) || "0.00"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">HST (15%)</span>
                <span>${currentPricing?.tax?.toFixed(2) || "0.00"}</span>
              </div>
              <div className="flex justify-between font-bold text-xl pt-2 mt-2">
                <span>Total</span>
                <span className="text-primary">${currentPricing?.total?.toFixed(2) || "0.00"}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Sticky Summary */}
      {step > 2 && step < 8 && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-border p-4 z-50 flex justify-between items-center">
          <div>
            <p className="text-xs text-muted-foreground">Estimated Total</p>
            <p className="text-lg font-bold text-primary">${currentPricing?.total?.toFixed(2) || "0.00"}</p>
          </div>
          <Button 
            className="bg-primary text-primary-foreground"
            onClick={step === 7 ? handleSubmit : handleNext}
            disabled={
              (step === 7 && (!state.appointmentAt || !state.timeSlot || !state.customer.name || !state.customer.email))
            }
          >
            {step === 7 ? "Confirm" : "Next"} <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
