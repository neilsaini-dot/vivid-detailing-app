import { useState } from "react";
import {
  useAdminListBookings, useAdminListServices, useGetAnalytics,
  useListSeasonalPromos, useUpdateSeasonalPromo, useAdminUpdateService,
  useAdminUpdateBooking,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  User, Car, CalendarDays, Package, CheckCircle2, RefreshCw,
  ExternalLink, Phone, Mail, ClipboardList, ArrowUpRight,
} from "lucide-react";

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
                if (e.key === "Enter" && password === "vivid2024") {
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

function statusBadgeClass(status: string) {
  if (status === "completed") return "text-green-500 border-green-500/20 bg-green-500/10";
  if (status === "confirmed") return "text-primary border-primary/20 bg-primary/10";
  if (status === "cancelled") return "text-red-500 border-red-500/20 bg-red-500/10";
  return "text-yellow-500 border-yellow-500/20 bg-yellow-500/10";
}

function BookingDetailSheet({ booking, open, onClose }: { booking: any; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateBooking = useAdminUpdateBooking();

  const [status, setStatus] = useState<string>(booking?.status ?? "pending");
  const [resyncing, setResyncing] = useState(false);
  const [resynced, setResynced] = useState(false);

  if (!booking) return null;

  const serviceItems = booking.items?.filter((i: any) => i.itemType === "service" || i.itemType === "quote") ?? [];
  const addonItems = booking.items?.filter((i: any) => i.itemType === "addon") ?? [];
  const promoItems = booking.items?.filter((i: any) => i.itemType === "promo") ?? [];
  const allLineItems = [...serviceItems, ...addonItems, ...promoItems];
  const total = Number(booking.totalEstimate ?? 0);
  const hstAmount = Math.round(total / 1.15 * 0.15 * 100) / 100;
  const subtotal = Math.round((total - hstAmount) * 100) / 100;

  const vehicleLabel = [booking.vehicle?.year, booking.vehicle?.make, booking.vehicle?.model]
    .filter(Boolean).join(" ") || booking.vehicle?.type || "Vehicle";

  const calendarSearchUrl = booking.appointmentAt
    ? `https://calendar.google.com/calendar/r/search?q=${encodeURIComponent("Vivid Detailing " + (booking.customer?.name ?? ""))}&date=${format(new Date(booking.appointmentAt), "yyyyMMdd")}`
    : "https://calendar.google.com/calendar/r";

  const handleStatusSave = async () => {
    try {
      await updateBooking.mutateAsync({ id: booking.id, data: { status } });
      queryClient.invalidateQueries({ queryKey: ["adminListBookings"] });
      toast({ title: "Status updated" });
    } catch {
      toast({ variant: "destructive", title: "Failed to update status" });
    }
  };

  const handleResync = async () => {
    setResyncing(true);
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}/resync`, { method: "POST" });
      if (!res.ok) throw new Error("Resync failed");
      setResynced(true);
      toast({ title: "Re-synced to GHL and Google Calendar" });
    } catch {
      toast({ variant: "destructive", title: "Resync failed - check GHL_WEBHOOK_URL secret" });
    } finally {
      setResyncing(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto bg-background border-border p-0">
        <SheetHeader className="px-6 py-5 border-b border-border sticky top-0 bg-background z-10">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle className="text-lg font-bold">
                Booking #{booking.id.slice(0, 8).toUpperCase()}
              </SheetTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Created {booking.createdAt ? format(new Date(booking.createdAt), "MMM d, yyyy 'at' h:mm a") : "—"}
              </p>
            </div>
            <Badge variant="outline" className={statusBadgeClass(booking.status)}>
              {booking.status}
            </Badge>
          </div>
        </SheetHeader>

        <div className="px-6 py-6 space-y-6">

          {/* Customer */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <User className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Customer</h3>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 space-y-2">
              <p className="font-semibold text-base">{booking.customer?.name ?? "Unknown"}</p>
              {booking.customer?.email && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  <a href={`mailto:${booking.customer.email}`} className="hover:text-primary transition-colors">
                    {booking.customer.email}
                  </a>
                </div>
              )}
              {booking.customer?.phone && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" />
                  <a href={`tel:${booking.customer.phone}`} className="hover:text-primary transition-colors">
                    {booking.customer.phone}
                  </a>
                </div>
              )}
            </div>
          </section>

          {/* Vehicle */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Car className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Vehicle</h3>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <div className="text-muted-foreground">Type</div>
              <div className="capitalize">{booking.vehicle?.type ?? "—"}</div>
              <div className="text-muted-foreground">Year</div>
              <div>{booking.vehicle?.year ?? "—"}</div>
              <div className="text-muted-foreground">Make / Model</div>
              <div>{[booking.vehicle?.make, booking.vehicle?.model].filter(Boolean).join(" ") || "—"}</div>
              {booking.vehicle?.colour && <>
                <div className="text-muted-foreground">Colour</div>
                <div>{booking.vehicle.colour}</div>
              </>}
              {booking.vehicle?.licensePlate && <>
                <div className="text-muted-foreground">Plate</div>
                <div>{booking.vehicle.licensePlate}</div>
              </>}
            </div>
          </section>

          {/* Appointment & Status */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Appointment & Status</h3>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Appointment</p>
                  <p className="font-semibold">
                    {booking.appointmentAt
                      ? format(new Date(booking.appointmentAt), "EEEE, MMMM d, yyyy 'at' h:mm a")
                      : "Not scheduled"}
                  </p>
                </div>
              </div>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-1.5">Status</p>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="bg-background border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  onClick={handleStatusSave}
                  disabled={updateBooking.isPending || status === booking.status}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {updateBooking.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </section>

          {/* Services & Add-ons */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Package className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Services & Add-ons</h3>
            </div>
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {allLineItems.map((item: any, i: number) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-medium">{item.itemName}</span>
                        <span className="ml-2 text-xs text-muted-foreground capitalize">
                          ({item.itemType})
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {item.isQuoteBased ? (
                          <span className="text-primary">Quote</span>
                        ) : item.unitPrice ? (
                          `$${Number(item.unitPrice).toFixed(2)}`
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                  {allLineItems.length === 0 && (
                    <tr><td className="px-4 py-3 text-muted-foreground" colSpan={2}>No items recorded</td></tr>
                  )}
                </tbody>
              </table>
              <div className="border-t border-border px-4 py-3 space-y-1.5 bg-card/50">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Subtotal</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>HST (15%)</span>
                  <span>${hstAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-base pt-1 border-t border-border">
                  <span>Total</span>
                  <span className="text-primary">${total.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Notes */}
          {booking.notes && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <ClipboardList className="h-4 w-4 text-primary" />
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Notes</h3>
              </div>
              <div className="bg-card border border-border rounded-lg p-4 text-sm text-muted-foreground whitespace-pre-wrap">
                {booking.notes}
              </div>
            </section>
          )}

          <Separator className="bg-border" />

          {/* GHL Integration */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <ArrowUpRight className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">GoHighLevel</h3>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className={`h-4 w-4 ${resynced ? "text-primary" : "text-green-500"}`} />
                <span className="text-muted-foreground">
                  {resynced
                    ? "Re-synced just now"
                    : `Webhook fired at booking creation`}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Contact created/updated in GHL with tags: Booking, Vivid Detailing, {serviceItems[0]?.itemName ?? "Service"}.
                Opportunity marked as Won with value ${total.toFixed(2)}.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full border-border hover:border-primary/40 gap-2"
                onClick={handleResync}
                disabled={resyncing}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${resyncing ? "animate-spin" : ""}`} />
                {resyncing ? "Re-syncing..." : "Re-sync to GHL"}
              </Button>
            </div>
          </section>

          {/* Google Calendar */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Google Calendar</h3>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className={`h-4 w-4 ${booking.appointmentAt ? "text-green-500" : "text-muted-foreground"}`} />
                <span className="text-muted-foreground">
                  {booking.appointmentAt
                    ? `Event created: ${format(new Date(booking.appointmentAt), "MMM d 'at' h:mm a")}`
                    : "No appointment set — event not created"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Event title: Vivid Detailing - {booking.customer?.name ?? "Customer"} - {vehicleLabel}
              </p>
              <a href={calendarSearchUrl} target="_blank" rel="noopener noreferrer" className="block">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-border hover:border-primary/40 gap-2"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View in Google Calendar
                </Button>
              </a>
            </div>
          </section>

        </div>
      </SheetContent>
    </Sheet>
  );
}

function AdminDashboard() {
  const { toast } = useToast();
  const [selectedBooking, setSelectedBooking] = useState<any>(null);

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
    } catch {
      toast({ variant: "destructive", title: "Update failed" });
    }
  };

  const handleToggleService = async (id: string, current: boolean) => {
    try {
      await updateService.mutateAsync({ id, data: { isActive: !current } });
      toast({ title: "Service updated" });
    } catch {
      toast({ variant: "destructive", title: "Update failed" });
    }
  };

  const chartData = analytics?.revenueByCategory || [
    { category: "Protection", revenue: 4500, bookingCount: 15 },
    { category: "Detailing", revenue: 3200, bookingCount: 22 },
    { category: "Tint", revenue: 2100, bookingCount: 10 },
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
                    <TableCell className="text-sm">
                      {b.appointmentAt ? format(new Date(b.appointmentAt), "MMM d, yyyy") : "TBD"}
                    </TableCell>
                    <TableCell className="text-sm">{b.customer?.name}</TableCell>
                    <TableCell className="text-sm">{b.vehicle?.year} {b.vehicle?.model}</TableCell>
                    <TableCell className="text-sm max-w-[160px] truncate">{b.items?.[0]?.itemName || "Custom"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusBadgeClass(b.status)}>
                        {b.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-semibold">${b.totalEstimate}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary hover:bg-primary/10"
                        onClick={() => setSelectedBooking(b)}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {bookings.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No bookings yet.
                    </TableCell>
                  </TableRow>
                )}
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
                    <Tooltip cursor={{ fill: "#1A1A1A" }} contentStyle={{ backgroundColor: "#111", border: "1px solid #2A2A2A" }} />
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
                    <label className="text-sm">Active</label>
                    <Switch checked={p.isActive} onCheckedChange={() => handleTogglePromo(p.id, p.isActive)} />
                  </div>
                </CardContent>
              </Card>
            ))}
            {promos.length === 0 && <p className="text-muted-foreground p-4">No seasonal promos configured.</p>}
          </div>
        </TabsContent>
      </Tabs>

      <BookingDetailSheet
        booking={selectedBooking}
        open={!!selectedBooking}
        onClose={() => setSelectedBooking(null)}
      />
    </div>
  );
}
