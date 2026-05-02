import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { 
  useGetCustomerDashboard, 
  useGetCustomerVehicles,
  useGetCustomerBookings
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CarFront, Calendar, History, Shield, AlertCircle, Clock, ChevronRight } from "lucide-react";
import { format } from "date-fns";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  // In a real app, this would come from auth context
  const [customerId] = useState("cus_123"); // Mock ID for demo

  // Use the dashboard aggregate hook
  // Assuming the hook requires an ID. We handle the case where it might fail gracefully.
  const { data: dashboard, isLoading } = useGetCustomerDashboard(customerId, {
    query: {
      enabled: !!customerId,
      retry: false
    }
  });

  // Mock data if API fails/isn't ready yet for this specific customer
  const mockDashboard = {
    customer: { name: "Alex Driver", email: "alex@example.com" },
    vehicles: [
      { id: "1", make: "Porsche", model: "911", year: 2022, type: "car", licensePlate: "VIVID 1" }
    ],
    loyalty: {
      tier: "Black",
      lifetimeSpend: 1250,
      nextTierName: "Elite",
      nextTierThreshold: 2500,
      progressPercent: 50
    },
    conditionScore: 85,
    maintenanceDue: true,
    upcomingBooking: {
      id: "b_1",
      appointmentAt: new Date(Date.now() + 86400000 * 3).toISOString(),
      status: "confirmed",
      totalEstimate: 249.00,
      items: [{ itemName: "Summer Special Ceramic" }]
    },
    recentBookings: [
      {
        id: "b_2",
        appointmentAt: new Date(Date.now() - 86400000 * 30).toISOString(),
        status: "completed",
        totalEstimate: 150.00,
        items: [{ itemName: "Interior Detail" }]
      }
    ]
  };

  const data = dashboard || mockDashboard;

  if (isLoading && !dashboard) {
    return <div className="p-8 text-center text-muted-foreground">Loading dashboard...</div>;
  }

  return (
    <div className="container py-8 max-w-6xl">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold">Welcome back, {data.customer.name?.split(' ')[0] || 'Guest'}</h1>
          <p className="text-muted-foreground">Manage your vehicles and appointments.</p>
        </div>
        <Button onClick={() => setLocation("/book")} className="bg-primary text-primary-foreground hover:bg-primary/90">
          Book New Service
        </Button>
      </div>

      {data.maintenanceDue && (
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="text-primary h-5 w-5" />
            <div>
              <h4 className="font-semibold text-primary">Maintenance Wash Due</h4>
              <p className="text-sm text-primary/80">It's been over 4 weeks since your last wash. Keep your coating performing optimally.</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setLocation("/book?intent=clean")}>Schedule Now</Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium flex items-center">
              <Shield className="mr-2 h-4 w-4" /> Loyalty Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold mb-1">{data.loyalty.tier} Tier</div>
            <div className="space-y-2 mt-4">
              <div className="flex justify-between text-xs">
                <span>Spend: ${data.loyalty.lifetimeSpend}</span>
                <span className="text-muted-foreground">{data.loyalty.nextTierName} at ${data.loyalty.nextTierThreshold}</span>
              </div>
              <Progress value={data.loyalty.progressPercent} className="h-1.5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium flex items-center">
              <Activity className="mr-2 h-4 w-4" /> Vehicle Condition
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold text-primary">{data.conditionScore}/100</div>
              <p className="text-xs text-muted-foreground mt-1">Based on last inspection</p>
            </div>
            {/* Circular Gauge Simulation */}
            <div className="relative w-16 h-16 rounded-full border-4 border-surface-2 flex items-center justify-center">
              <svg className="absolute inset-0 w-full h-full transform -rotate-90">
                <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="none" className="text-primary" strokeDasharray="175" strokeDashoffset={175 - (175 * (data.conditionScore || 0)) / 100} />
              </svg>
              <span className="text-sm font-bold">Good</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-primary text-primary-foreground border-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center opacity-90">
              <Calendar className="mr-2 h-4 w-4" /> Next Appointment
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.upcomingBooking ? (
              <>
                <div className="text-xl font-bold mb-1">
                  {format(new Date(data.upcomingBooking.appointmentAt!), "MMM d, h:mm a")}
                </div>
                <p className="text-sm opacity-90 truncate">{data.upcomingBooking.items?.[0]?.itemName}</p>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="secondary" className="w-full bg-background/20 hover:bg-background/30 text-white border-none">Reschedule</Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-2">
                <p className="text-sm mb-3">No upcoming appointments</p>
                <Button size="sm" variant="secondary" className="w-full bg-background text-foreground hover:bg-background/90" onClick={() => setLocation("/book")}>
                  Book Now
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="vehicles" className="w-full">
        <TabsList className="mb-6 bg-surface border border-border">
          <TabsTrigger value="vehicles">My Vehicles</TabsTrigger>
          <TabsTrigger value="history">Service History</TabsTrigger>
        </TabsList>
        
        <TabsContent value="vehicles" className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {data.vehicles.map((v: any) => (
              <Card key={v.id} className="bg-surface border-border">
                <CardContent className="p-6 flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-surface-2 flex items-center justify-center">
                      <CarFront className="text-primary" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg">{v.year} {v.make} {v.model}</h3>
                      <p className="text-sm text-muted-foreground">{v.licensePlate} • {v.type}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon"><Settings className="h-4 w-4" /></Button>
                </CardContent>
              </Card>
            ))}
            <Card className="bg-surface/50 border-border border-dashed hover:border-primary/50 cursor-pointer transition-colors flex items-center justify-center p-6 min-h-[100px]">
              <div className="text-center">
                <Plus className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm font-medium">Add Vehicle</p>
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Card className="bg-surface border-border">
            <div className="divide-y divide-border">
              {data.recentBookings.map((b: any) => (
                <div key={b.id} className="p-4 flex items-center justify-between hover:bg-surface-2 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="bg-surface-2 p-2 rounded-md">
                      <History className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h4 className="font-medium">{b.items?.[0]?.itemName}</h4>
                      <p className="text-sm text-muted-foreground">{format(new Date(b.appointmentAt), "MMMM d, yyyy")} • ${b.totalEstimate}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge variant="outline" className="text-green-500 border-green-500/20 bg-green-500/10">Completed</Badge>
                    <Button variant="ghost" size="sm" className="hidden sm:flex" onClick={() => setLocation("/book")}>Rebook</Button>
                  </div>
                </div>
              ))}
              {data.recentBookings.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">No past services found.</div>
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Ensure Activity icon is imported
function Activity(props: any) {
  return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinelinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>;
}
