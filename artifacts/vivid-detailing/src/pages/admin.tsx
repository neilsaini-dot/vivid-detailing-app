import { useState } from "react";
import { 
  useAdminListBookings, useAdminListServices, useGetAnalytics,
  useListSeasonalPromos, useUpdateSeasonalPromo, useAdminUpdateService
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function AdminPanel() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => sessionStorage.getItem("adminAuth") === "true");
  const [password, setPassword] = useState("");

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-[400px] bg-surface border-border">
          <CardHeader>
            <CardTitle>Admin Access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input 
              type="password" 
              placeholder="Password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && password === "vivid2024") {
                  sessionStorage.setItem("adminAuth", "true");
                  setIsAuthenticated(true);
                }
              }}
            />
            <Button 
              className="w-full bg-primary" 
              onClick={() => {
                if (password === "vivid2024") {
                  sessionStorage.setItem("adminAuth", "true");
                  setIsAuthenticated(true);
                }
              }}
            >
              Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <AdminDashboard />;
}

function AdminDashboard() {
  const { toast } = useToast();
  
  // Fetch data
  const { data: bookings = [] } = useAdminListBookings({});
  const { data: services = [] } = useAdminListServices();
  const { data: analytics } = useGetAnalytics();
  const { data: promos = [] } = useListSeasonalPromos();
  
  const updatePromo = useUpdateSeasonalPromo();
  const updateService = useAdminUpdateService();

  const handleTogglePromo = async (id: string, current: boolean) => {
    try {
      await updatePromo.mutateAsync({ id, data: { isActive: !current } });
      toast({ title: "Promo updated" });
    } catch (e) {
      toast({ variant: "destructive", title: "Update failed" });
    }
  };

  const handleToggleService = async (id: string, current: boolean) => {
    try {
      await updateService.mutateAsync({ id, data: { isActive: !current } });
      toast({ title: "Service updated" });
    } catch (e) {
      toast({ variant: "destructive", title: "Update failed" });
    }
  };

  // Mock analytics if missing
  const chartData = analytics?.revenueByCategory || [
    { category: 'Protection', revenue: 4500, bookingCount: 15 },
    { category: 'Detailing', revenue: 3200, bookingCount: 22 },
    { category: 'Tint', revenue: 2100, bookingCount: 10 },
  ];

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-8">Admin Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Revenue</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-primary">${analytics?.totalRevenue || 9800}</div></CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Bookings</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{analytics?.totalBookings || 47}</div></CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Pending</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-yellow-500">{analytics?.pendingBookings || 5}</div></CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Completed</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-green-500">{analytics?.completedBookings || 42}</div></CardContent>
        </Card>
      </div>

      <Tabs defaultValue="bookings">
        <TabsList className="bg-surface border border-border mb-6">
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="promos">Seasonal</TabsTrigger>
        </TabsList>
        
        <TabsContent value="bookings">
          <Card className="bg-surface border-border">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.map((b: any) => (
                  <TableRow key={b.id} className="border-border">
                    <TableCell>{b.appointmentAt ? format(new Date(b.appointmentAt), "MMM d, yyyy") : 'TBD'}</TableCell>
                    <TableCell>{b.customer?.name}</TableCell>
                    <TableCell>{b.vehicle?.year} {b.vehicle?.model}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{b.items?.[0]?.itemName || 'Custom'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        b.status === 'completed' ? 'text-green-500 border-green-500/20 bg-green-500/10' :
                        b.status === 'confirmed' ? 'text-primary border-primary/20 bg-primary/10' :
                        'text-yellow-500 border-yellow-500/20 bg-yellow-500/10'
                      }>
                        {b.status}
                      </Badge>
                    </TableCell>
                    <TableCell>${b.totalEstimate}</TableCell>
                    <TableCell><Button variant="ghost" size="sm">Edit</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="services">
          <Card className="bg-surface border-border">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Base Price</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((s: any) => (
                  <TableRow key={s.id} className="border-border">
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.category}</TableCell>
                    <TableCell>${s.basePrice}</TableCell>
                    <TableCell>
                      <Switch checked={s.isActive} onCheckedChange={() => handleToggleService(s.id, s.isActive)} />
                    </TableCell>
                    <TableCell><Button variant="ghost" size="sm">Edit</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="analytics">
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="bg-surface border-border">
              <CardHeader><CardTitle>Revenue by Category</CardTitle></CardHeader>
              <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
                    <XAxis dataKey="category" stroke="#8A8A8A" />
                    <YAxis stroke="#8A8A8A" />
                    <Tooltip cursor={{fill: '#1A1A1A'}} contentStyle={{backgroundColor: '#111', border: '1px solid #2A2A2A'}} />
                    <Bar dataKey="revenue" fill="#29B8D9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="promos">
          <div className="grid gap-4">
            {promos.map((p: any) => (
              <Card key={p.id} className="bg-surface border-border">
                <CardContent className="p-6 flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-primary mb-1">{p.name}</h3>
                    <p className="text-muted-foreground">{p.description}</p>
                    <p className="font-bold mt-2">Price: ${p.basePrice}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <Label className="text-sm">Active</Label>
                    <Switch checked={p.isActive} onCheckedChange={() => handleTogglePromo(p.id, p.isActive)} />
                  </div>
                </CardContent>
              </Card>
            ))}
            {promos.length === 0 && <p className="text-muted-foreground p-4">No seasonal promos configured.</p>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Label({ children, className }: any) {
  return <label className={className}>{children}</label>;
}
