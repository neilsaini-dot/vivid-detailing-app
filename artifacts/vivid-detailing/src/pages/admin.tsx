import { useState } from "react";
import {
  useAdminListBookings, useAdminListServices, useGetAnalytics,
  useListSeasonalPromos, useUpdateSeasonalPromo, useCreateSeasonalPromo,
  useDeleteSeasonalPromo, useAdminUpdateService, useAdminUpdateBooking,
  useAdminCreateBooking, useAdminSearchCustomers,
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
  Camera, Upload, X, Eye, Plus, Trash2, Pencil, Tag, CalendarRange,
  ChevronDown, Link as LinkIcon,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useRef, useEffect, useCallback, useMemo } from "react";
import { useDebounce } from "@/hooks/use-debounce";

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
  const [sendingPortal, setSendingPortal] = useState(false);
  const [portalSent, setPortalSent] = useState(false);

  // Photos & condition state
  const [conditionScore, setConditionScore] = useState<string>("");
  const [beforeUrls, setBeforeUrls] = useState<string[]>([]);
  const [afterUrls, setAfterUrls] = useState<string[]>([]);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [uploadingBefore, setUploadingBefore] = useState(false);
  const [uploadingAfter, setUploadingAfter] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [driveSyncing, setDriveSyncing] = useState(false);
  const [driveFolderUrl, setDriveFolderUrl] = useState<string | null>(null);
  const beforeInputRef = useRef<HTMLInputElement>(null);
  const afterInputRef = useRef<HTMLInputElement>(null);
  // Two-step Supabase upload: request signed URL → PUT file directly to CDN.
  // Returns the full public URL (stored in DB, used directly as <img src>).
  const uploadPhoto = async (file: File, photoType: "before" | "after"): Promise<string | null> => {
    const metaRes = await fetch("/api/storage/uploads/request-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name,
        size: file.size,
        contentType: file.type || "image/jpeg",
        bookingId: booking.id,
        photoType,
      }),
    });
    if (!metaRes.ok) throw new Error("Failed to get upload URL");
    const { uploadURL, objectPath } = await metaRes.json();
    const putRes = await fetch(uploadURL, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "image/jpeg" },
    });
    if (!putRes.ok) throw new Error("Failed to upload to storage");
    return objectPath as string;
  };

  // Load existing service history when sheet opens
  useEffect(() => {
    if (!open || !booking?.id) return;
    setConditionScore("");
    setBeforeUrls([]);
    setAfterUrls([]);
    setDriveFolderUrl(null);
    fetch(`/api/admin/bookings/${booking.id}/service-history`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setConditionScore(data.conditionScore != null ? String(data.conditionScore) : "");
          setBeforeUrls(data.beforePhotoUrls ?? []);
          setAfterUrls(data.afterPhotoUrls ?? []);
          setDriveFolderUrl(data.driveFolderUrl ?? null);
        }
      })
      .catch(() => {});
  }, [open, booking?.id]);

  const handleAddPhotos = async (files: FileList | null, type: "before" | "after") => {
    if (!files || files.length === 0) return;
    if (type === "before") setUploadingBefore(true);
    else setUploadingAfter(true);
    try {
      const paths: string[] = [];
      for (const file of Array.from(files)) {
        const objectPath = await uploadPhoto(file, type);
        if (objectPath) paths.push(objectPath);
      }
      if (type === "before") setBeforeUrls(prev => [...prev, ...paths]);
      else setAfterUrls(prev => [...prev, ...paths]);
    } catch {
      // individual upload errors are shown per-file; global catch is a no-op
    } finally {
      if (type === "before") setUploadingBefore(false);
      else setUploadingAfter(false);
    }
  };

  const handleSyncToDrive = async () => {
    setDriveSyncing(true);
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}/sync-to-drive`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setDriveFolderUrl(data.folderUrl);
      toast({ title: `Synced to Google Drive — ${data.uploaded.before} before, ${data.uploaded.after} after photo(s)` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sync failed";
      toast({ variant: "destructive", title: msg });
    } finally {
      setDriveSyncing(false);
    }
  };

  const handleSavePhotos = async () => {
    setPhotoSaving(true);
    try {
      const score = conditionScore !== "" ? Number(conditionScore) : undefined;
      await updateBooking.mutateAsync({
        id: booking.id,
        data: {
          conditionScore: score,
          beforePhotoUrls: beforeUrls,
          afterPhotoUrls: afterUrls,
        },
      });
      queryClient.invalidateQueries({ queryKey: ["adminListBookings"] });
      toast({ title: "Photos saved" });
    } catch {
      toast({ variant: "destructive", title: "Failed to save photos" });
    } finally {
      setPhotoSaving(false);
    }
  };

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
      await updateBooking.mutateAsync({ id: booking.id, data: { status: status as any } });
      queryClient.invalidateQueries({ queryKey: ["adminListBookings"] });
      toast({ title: "Status updated" });
    } catch {
      toast({ variant: "destructive", title: "Failed to update status" });
    }
  };

  const handleSendPortalLink = async () => {
    setSendingPortal(true);
    try {
      const res = await fetch(`/api/bookings/${booking.id}/magic-link`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      setPortalSent(true);
      toast({ title: "Portal link sent to customer via GHL" });
    } catch {
      toast({ variant: "destructive", title: "Failed to send portal link — check GHL_MAGIC_LINK_WEBHOOK_URL secret" });
    } finally {
      setSendingPortal(false);
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

          {/* Photos & Condition */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Camera className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Photos & Condition</h3>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 space-y-4">
              {/* Condition score */}
              <div className="flex items-center gap-3">
                <label className="text-sm text-muted-foreground w-32 shrink-0">Condition Score</label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="0–100"
                  value={conditionScore}
                  onChange={e => setConditionScore(e.target.value)}
                  className="w-24 bg-background border-border"
                />
                <span className="text-xs text-muted-foreground">/100</span>
              </div>

              {/* Before photos */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Before Photos</p>
                  <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs border-border" disabled={uploadingBefore} onClick={() => beforeInputRef.current?.click()}>
                    {uploadingBefore ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    {uploadingBefore ? "Uploading…" : "Add"}
                  </Button>
                  <input ref={beforeInputRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={e => { handleAddPhotos(e.target.files, "before"); e.target.value = ""; }} />
                </div>
                {beforeUrls.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {beforeUrls.map((url, i) => {
                      const src = url.startsWith("/objects/") ? `/api/storage${url}` : url;
                      return (
                        <div key={i} className="relative group aspect-square rounded overflow-hidden border border-border">
                          <img src={src} alt={`before-${i}`} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                            <button onClick={() => setLightboxSrc(src)} className="p-1 bg-black/60 rounded hover:bg-black/80">
                              <Eye className="h-3.5 w-3.5 text-white" />
                            </button>
                            <button onClick={() => setBeforeUrls(prev => prev.filter((_, j) => j !== i))} className="p-1 bg-black/60 rounded hover:bg-black/80">
                              <X className="h-3.5 w-3.5 text-white" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="border border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/40 transition-colors"
                    onClick={() => beforeInputRef.current?.click()}>
                    <p className="text-xs text-muted-foreground">{uploadingBefore ? "Uploading…" : "Click to upload before photos"}</p>
                  </div>
                )}
              </div>

              {/* After photos */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">After Photos</p>
                  <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs border-border" disabled={uploadingAfter} onClick={() => afterInputRef.current?.click()}>
                    {uploadingAfter ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    {uploadingAfter ? "Uploading…" : "Add"}
                  </Button>
                  <input ref={afterInputRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={e => { handleAddPhotos(e.target.files, "after"); e.target.value = ""; }} />
                </div>
                {afterUrls.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {afterUrls.map((url, i) => {
                      const src = url.startsWith("/objects/") ? `/api/storage${url}` : url;
                      return (
                        <div key={i} className="relative group aspect-square rounded overflow-hidden border border-border">
                          <img src={src} alt={`after-${i}`} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                            <button onClick={() => setLightboxSrc(src)} className="p-1 bg-black/60 rounded hover:bg-black/80">
                              <Eye className="h-3.5 w-3.5 text-white" />
                            </button>
                            <button onClick={() => setAfterUrls(prev => prev.filter((_, j) => j !== i))} className="p-1 bg-black/60 rounded hover:bg-black/80">
                              <X className="h-3.5 w-3.5 text-white" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="border border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/40 transition-colors"
                    onClick={() => afterInputRef.current?.click()}>
                    <p className="text-xs text-muted-foreground">{uploadingAfter ? "Uploading…" : "Click to upload after photos"}</p>
                  </div>
                )}
              </div>

              <Button
                size="sm"
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleSavePhotos}
                disabled={photoSaving}
              >
                {photoSaving ? "Saving..." : "Save Photos & Score"}
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="w-full border-border hover:border-primary/40 gap-2"
                onClick={handleSyncToDrive}
                disabled={driveSyncing || (beforeUrls.length === 0 && afterUrls.length === 0)}
              >
                {driveSyncing
                  ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Syncing to Drive…</>
                  : <><ExternalLink className="h-3.5 w-3.5" /> Sync to Google Drive</>}
              </Button>

              {driveFolderUrl && (
                <a
                  href={driveFolderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View folder in Google Drive
                </a>
              )}
            </div>
          </section>

          {/* Lightbox */}
          {lightboxSrc && (
            <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setLightboxSrc(null)}>
              <img src={lightboxSrc} alt="Photo" className="max-w-full max-h-full object-contain rounded" />
              <button className="absolute top-4 right-4 p-2 bg-white/10 rounded-full hover:bg-white/20" onClick={() => setLightboxSrc(null)}>
                <X className="h-5 w-5 text-white" />
              </button>
            </div>
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

              <div className="border-t border-border pt-3 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <LinkIcon className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-muted-foreground text-xs">
                    {portalSent
                      ? "Portal link sent — customer can access their booking dashboard"
                      : "Send the customer a link to their booking portal via GHL automation"}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-border hover:border-primary/40 gap-2"
                  onClick={handleSendPortalLink}
                  disabled={sendingPortal}
                >
                  <LinkIcon className={`h-3.5 w-3.5 ${sendingPortal ? "animate-pulse" : ""}`} />
                  {sendingPortal ? "Sending..." : portalSent ? "Re-send Portal Link" : "Send Portal Link"}
                </Button>
              </div>
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

// ─── Source badge helpers ─────────────────────────────────────────────────────
const SOURCE_LABELS: Record<string, string> = {
  online: "Online", phone: "Phone", walkin: "Walk-in", referral: "Referral", other: "Other",
};
const SOURCE_BADGE_CLASS: Record<string, string> = {
  online: "text-blue-400 border-blue-500/20 bg-blue-500/10",
  phone: "text-purple-400 border-purple-500/20 bg-purple-500/10",
  walkin: "text-orange-400 border-orange-500/20 bg-orange-500/10",
  referral: "text-green-400 border-green-500/20 bg-green-500/10",
  other: "text-muted-foreground border-border",
};

// ─── Phone formatting helpers ─────────────────────────────────────────────────
function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// ─── Manual Booking Sheet ─────────────────────────────────────────────────────
type LineItem = { description: string; price: string };
const QUICK_SERVICES = [
  { label: "Full Detail", price: "299" },
  { label: "Exterior Wash", price: "79" },
  { label: "Interior Detail", price: "149" },
  { label: "Paint Protection Film", price: "699" },
  { label: "Ceramic Coating", price: "899" },
  { label: "Window Tint", price: "349" },
  { label: "Headlight Restoration", price: "99" },
  { label: "Engine Bay Clean", price: "99" },
];

function ManualBookingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createBooking = useAdminCreateBooking();

  // Customer search state
  const [customerMode, setCustomerMode] = useState<"search" | "new">("search");
  const [customerSearch, setCustomerSearch] = useState("");
  const debouncedSearch = useDebounce(customerSearch, 350);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");

  // Vehicle state
  const [vehicleMode, setVehicleMode] = useState<"select" | "new">("select");
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("__none__");
  const [newVehicle, setNewVehicle] = useState({ type: "car" as const, year: "", make: "", model: "", colour: "", licensePlate: "" });

  // Line items
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: "", price: "" }]);

  // Booking meta
  const [source, setSource] = useState<"online" | "phone" | "walkin" | "referral" | "other">("phone");
  const [status, setStatus] = useState<"pending" | "confirmed" | "completed">("confirmed");
  const [appointmentAt, setAppointmentAt] = useState("");
  const [notes, setNotes] = useState("");
  const [totalOverride, setTotalOverride] = useState("");
  const [isManualTotal, setIsManualTotal] = useState(false);

  const searchEnabled = debouncedSearch.length >= 2 && customerMode === "search" && !selectedCustomer;
  const { data: searchResults = [], isFetching: searching } = useAdminSearchCustomers(
    { q: debouncedSearch },
    { query: { enabled: searchEnabled } as any }
  );

  // Duplicate detection when creating a new customer — phone first, email second.
  // Deliberately never falls back to name: two different people can share a name.
  const newCustomerPhoneDigits = newCustomerPhone.replace(/\D/g, "");
  const dupRaw = newCustomerPhoneDigits.length >= 6
    ? newCustomerPhone
    : newCustomerEmail.trim().includes("@") ? newCustomerEmail.trim() : "";
  const debouncedDupQuery = useDebounce(dupRaw, 400);
  const dupCheckEnabled = customerMode === "new" && debouncedDupQuery.length >= 2;
  const { data: dupResults = [] } = useAdminSearchCustomers(
    { q: debouncedDupQuery },
    { query: { enabled: dupCheckEnabled } as any }
  );

  const HST_RATE = 0.15; // PEI HST

  const autoTotal = useMemo(() =>
    lineItems.reduce((sum, li) => sum + (parseFloat(li.price) || 0), 0),
    [lineItems]
  );

  const subtotal = isManualTotal && totalOverride ? parseFloat(totalOverride) || 0 : autoTotal;
  const hstAmount = subtotal * HST_RATE;
  const grandTotal = subtotal + hstAmount;

  const resetForm = useCallback(() => {
    setCustomerMode("search");
    setCustomerSearch("");
    setSelectedCustomer(null);
    setNewCustomerName(""); setNewCustomerEmail(""); setNewCustomerPhone("");
    setVehicleMode("select");
    setSelectedVehicleId("__none__");
    setNewVehicle({ type: "car", year: "", make: "", model: "", colour: "", licensePlate: "" });
    setLineItems([{ description: "", price: "" }]);
    setSource("phone");
    setStatus("confirmed");
    setAppointmentAt("");
    setNotes("");
    setTotalOverride("");
    setIsManualTotal(false);
  }, []);

  useEffect(() => { if (!open) resetForm(); }, [open, resetForm]);

  const handleSelectCustomer = (c: any) => {
    setSelectedCustomer(c);
    setCustomerSearch("");
    setVehicleMode("select");
    setSelectedVehicleId(c.vehicles?.[0]?.id ?? "__none__");
  };

  const addLineItem = () => setLineItems(prev => [...prev, { description: "", price: "" }]);
  const removeLineItem = (i: number) => setLineItems(prev => prev.filter((_, j) => j !== i));
  const updateLineItem = (i: number, field: keyof LineItem, val: string) =>
    setLineItems(prev => prev.map((li, j) => j === i ? { ...li, [field]: val } : li));
  const addQuickService = (svc: { label: string; price: string }) => {
    const empty = lineItems.findIndex(li => !li.description.trim());
    if (empty >= 0) {
      updateLineItem(empty, "description", svc.label);
      updateLineItem(empty, "price", svc.price);
    } else {
      setLineItems(prev => [...prev, { description: svc.label, price: svc.price }]);
    }
  };

  const handleSubmit = async () => {
    const validItems = lineItems.filter(li => li.description.trim());
    if (validItems.length === 0) {
      toast({ variant: "destructive", title: "Add at least one line item" });
      return;
    }
    if (customerMode === "search" && !selectedCustomer && !newCustomerName.trim()) {
      toast({ variant: "destructive", title: "Select or create a customer" });
      return;
    }

    try {
      const payload: any = {
        source,
        status,
        notes: notes.trim() || null,
        appointmentAt: appointmentAt || null,
        lineItems: validItems.map(li => ({ description: li.description.trim(), price: parseFloat(li.price) || 0 })),
        isManualPriceOverride: isManualTotal,
        totalOverride: isManualTotal && totalOverride ? parseFloat(totalOverride) : null,
      };

      if (selectedCustomer) {
        payload.customerId = selectedCustomer.id;
        if (vehicleMode === "select" && selectedVehicleId && selectedVehicleId !== "__none__") payload.vehicleId = selectedVehicleId;
        else if (vehicleMode === "new" && newVehicle.make) payload.newVehicle = {
          ...newVehicle,
          year: newVehicle.year ? parseInt(newVehicle.year) : null,
          customerId: selectedCustomer.id,
        };
      } else if (newCustomerName.trim()) {
        payload.newCustomer = {
          name: newCustomerName.trim(),
          email: newCustomerEmail.trim() || undefined,
          phone: newCustomerPhone.trim() || undefined,
        };
        if (newVehicle.make) payload.newVehicle = {
          ...newVehicle,
          year: newVehicle.year ? parseInt(newVehicle.year) : null,
        };
      }

      await createBooking.mutateAsync({ data: payload });
      queryClient.invalidateQueries({ queryKey: ["adminListBookings"] });
      toast({ title: "Booking created" });
      onClose();
    } catch {
      toast({ variant: "destructive", title: "Failed to create booking" });
    }
  };

  const vehicles = selectedCustomer?.vehicles ?? [];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto bg-background border-border p-0"
        onPointerDownOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="px-6 py-5 border-b border-border sticky top-0 bg-background z-10">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg font-bold">New Manual Booking</SheetTitle>
            <Badge variant="outline" className="text-xs text-muted-foreground border-border">Admin</Badge>
          </div>
        </SheetHeader>

        <div className="px-6 py-6 space-y-6">

          {/* ── Customer ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-primary" />
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Customer</h3>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant={customerMode === "search" ? "default" : "ghost"}
                  className={`h-7 text-xs px-2 ${customerMode === "search" ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground"}`}
                  onClick={() => { setCustomerMode("search"); setSelectedCustomer(null); }}>
                  Search
                </Button>
                <Button size="sm" variant={customerMode === "new" ? "default" : "ghost"}
                  className={`h-7 text-xs px-2 ${customerMode === "new" ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground"}`}
                  onClick={() => { setCustomerMode("new"); setSelectedCustomer(null); }}>
                  + New
                </Button>
              </div>
            </div>

            {customerMode === "search" && !selectedCustomer && (
              <div className="space-y-2">
                <Input
                  placeholder="Search by name, email, or phone…"
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  className="bg-surface-2 border-border"
                />
                {debouncedSearch.length >= 2 && (
                  <div className="border border-border rounded-lg overflow-hidden">
                    {searching ? (
                      <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Searching…
                      </div>
                    ) : searchResults.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground">
                        No customers found.{" "}
                        <button className="text-primary underline" onClick={() => { setCustomerMode("new"); setNewCustomerName(customerSearch); }}>
                          Create new?
                        </button>
                      </div>
                    ) : (
                      <ul>
                        {(searchResults as any[]).map((c: any) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              className="w-full text-left px-4 py-3 hover:bg-surface-2 border-b border-border last:border-0 transition-colors"
                              onClick={() => handleSelectCustomer(c)}
                            >
                              <p className="font-medium text-sm">{c.name ?? "—"}</p>
                              <p className="text-xs text-muted-foreground">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            {customerMode === "search" && selectedCustomer && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 flex items-start justify-between">
                <div>
                  <p className="font-semibold text-sm">{selectedCustomer.name}</p>
                  <p className="text-xs text-muted-foreground">{[selectedCustomer.phone, selectedCustomer.email].filter(Boolean).join(" · ")}</p>
                </div>
                <button className="text-muted-foreground hover:text-foreground" onClick={() => { setSelectedCustomer(null); setSelectedVehicleId(""); }}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {customerMode === "new" && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3">
                  <Input placeholder="Full name *" value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} className="bg-surface-2 border-border" />
                  <Input placeholder="Phone (e.g. 902-267-7775)" value={newCustomerPhone} onChange={e => setNewCustomerPhone(formatPhoneNumber(e.target.value))} className="bg-surface-2 border-border" />
                  <Input placeholder="Email" value={newCustomerEmail} onChange={e => setNewCustomerEmail(e.target.value)} className="bg-surface-2 border-border" />
                </div>

                {/* Duplicate warning — shown when an existing customer matches the entered phone/name */}
                {(dupResults as any[]).length > 0 && (
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 space-y-2">
                    <p className="text-xs font-semibold text-yellow-400 flex items-center gap-1.5">
                      <span>⚠</span> Possible duplicate — existing customer{(dupResults as any[]).length > 1 ? "s" : ""} found:
                    </p>
                    <ul className="space-y-1">
                      {(dupResults as any[]).map((c: any) => (
                        <li key={c.id} className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">{c.name ?? "—"}</p>
                            <p className="text-xs text-muted-foreground truncate">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
                          </div>
                          <button
                            type="button"
                            className="shrink-0 text-xs text-primary underline hover:no-underline"
                            onClick={() => { setCustomerMode("search"); handleSelectCustomer(c); }}
                          >
                            Use this
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Vehicle ── */}
          {(selectedCustomer || customerMode === "new") && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Car className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Vehicle</h3>
                </div>
                {selectedCustomer && vehicles.length > 0 && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost"
                      className={`h-7 text-xs px-2 ${vehicleMode === "select" ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground"}`}
                      onClick={() => setVehicleMode("select")}>
                      Existing
                    </Button>
                    <Button size="sm" variant="ghost"
                      className={`h-7 text-xs px-2 ${vehicleMode === "new" ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground"}`}
                      onClick={() => setVehicleMode("new")}>
                      + New
                    </Button>
                  </div>
                )}
              </div>

              {vehicleMode === "select" && selectedCustomer && vehicles.length > 0 ? (
                <Select value={selectedVehicleId} onValueChange={setSelectedVehicleId}>
                  <SelectTrigger className="bg-surface-2 border-border">
                    <SelectValue placeholder="Select vehicle" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No vehicle</SelectItem>
                    {vehicles.map((v: any) => (
                      <SelectItem key={v.id} value={v.id}>
                        {[v.year, v.make, v.model].filter(Boolean).join(" ") || v.type}
                        {v.colour ? ` (${v.colour})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Select value={newVehicle.type} onValueChange={v => setNewVehicle(p => ({ ...p, type: v as any }))}>
                    <SelectTrigger className="bg-surface-2 border-border"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="car">Car</SelectItem>
                      <SelectItem value="suv">SUV</SelectItem>
                      <SelectItem value="truck">Truck</SelectItem>
                      <SelectItem value="van">Van</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input placeholder="Year" value={newVehicle.year} onChange={e => setNewVehicle(p => ({ ...p, year: e.target.value }))} className="bg-surface-2 border-border" />
                  <Input placeholder="Make" value={newVehicle.make} onChange={e => setNewVehicle(p => ({ ...p, make: e.target.value }))} className="bg-surface-2 border-border" />
                  <Input placeholder="Model" value={newVehicle.model} onChange={e => setNewVehicle(p => ({ ...p, model: e.target.value }))} className="bg-surface-2 border-border" />
                  <Input placeholder="Colour" value={newVehicle.colour} onChange={e => setNewVehicle(p => ({ ...p, colour: e.target.value }))} className="bg-surface-2 border-border" />
                  <Input placeholder="Plate" value={newVehicle.licensePlate} onChange={e => setNewVehicle(p => ({ ...p, licensePlate: e.target.value }))} className="bg-surface-2 border-border" />
                </div>
              )}
            </section>
          )}

          {/* ── Line Items ── */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Services & Line Items</h3>
              </div>
            </div>

            {/* Quick service shortcuts */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {QUICK_SERVICES.map(svc => (
                <button
                  key={svc.label}
                  className="text-xs px-2.5 py-1 rounded-full border border-border hover:border-primary/40 hover:bg-primary/5 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => addQuickService(svc)}
                >
                  + {svc.label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {lineItems.map((li, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    placeholder="Description"
                    value={li.description}
                    onChange={e => updateLineItem(i, "description", e.target.value)}
                    className="flex-1 bg-surface-2 border-border text-sm"
                  />
                  <div className="relative w-24 shrink-0">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      placeholder="0"
                      value={li.price}
                      onChange={e => updateLineItem(i, "price", e.target.value)}
                      className="pl-6 bg-surface-2 border-border text-sm"
                    />
                  </div>
                  {lineItems.length > 1 && (
                    <button onClick={() => removeLineItem(i)} className="text-muted-foreground hover:text-red-400 transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <Button size="sm" variant="ghost" className="mt-2 text-xs text-muted-foreground hover:text-foreground gap-1.5" onClick={addLineItem}>
              <Plus className="h-3 w-3" /> Add line item
            </Button>

            {/* Total */}
            <div className="mt-3 border-t border-border pt-3 space-y-2">
              {/* Override checkbox + input */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <Checkbox
                    checked={isManualTotal}
                    onCheckedChange={(v) => setIsManualTotal(Boolean(v))}
                    className="border-border"
                  />
                  Override subtotal
                </label>
                {isManualTotal && (
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={totalOverride}
                      onChange={e => setTotalOverride(e.target.value)}
                      className="pl-6 bg-surface-2 border-border text-sm"
                    />
                  </div>
                )}
              </div>

              {/* Subtotal / HST / Grand total breakdown */}
              <div className="rounded-lg bg-surface-2 border border-border px-3 py-2.5 space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>HST (15%)</span>
                  <span>${hstAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-semibold text-foreground border-t border-border pt-1.5">
                  <span>Total (incl. HST)</span>
                  <span>${grandTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </section>

          {/* ── Booking Details ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Booking Details</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Source</label>
                <Select value={source} onValueChange={v => setSource(v as any)}>
                  <SelectTrigger className="bg-surface-2 border-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="phone">Phone</SelectItem>
                    <SelectItem value="walkin">Walk-in</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="referral">Referral</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Status</label>
                <Select value={status} onValueChange={v => setStatus(v as any)}>
                  <SelectTrigger className="bg-surface-2 border-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs text-muted-foreground">Appointment Date &amp; Time</label>
                <Input
                  type="datetime-local"
                  value={appointmentAt}
                  onChange={e => setAppointmentAt(e.target.value)}
                  className="bg-surface-2 border-border"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs text-muted-foreground">Notes</label>
                <textarea
                  rows={3}
                  placeholder="Internal notes about this booking…"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm resize-none placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </section>

          <Button
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
            onClick={handleSubmit}
            disabled={createBooking.isPending}
          >
            {createBooking.isPending ? <><RefreshCw className="h-4 w-4 animate-spin" /> Creating…</> : <>
              <Plus className="h-4 w-4" /> Create Booking
            </>}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AdminDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [showManualBooking, setShowManualBooking] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(
    () => (typeof history !== "undefined" && history.state?.adminTab) ? history.state.adminTab : "bookings"
  );

  useEffect(() => {
    // Push an initial history entry so the very first back press restores
    // to "bookings" rather than navigating away from /admin.
    if (!history.state?.adminTab) {
      history.replaceState({ adminTab: "bookings" }, "");
    }
    const onPop = (e: PopStateEvent) => {
      const tab = e.state?.adminTab ?? "bookings";
      setActiveTab(tab);
      setSelectedBooking(null);
      setShowManualBooking(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    history.pushState({ adminTab: tab }, "");
  };
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>("")
  const [bulkWorking, setBulkWorking] = useState(false);

  // Promo create form state
  const [showCreatePromo, setShowCreatePromo] = useState(false);
  const [newPromo, setNewPromo] = useState({
    name: "", basePrice: "", description: "", validFrom: "", validTo: "", includes: "",
  });
  const [editingPromoId, setEditingPromoId] = useState<string | null>(null);
  const [editPromo, setEditPromo] = useState<any>({});

  const { data: bookings = [] } = useAdminListBookings({});
  const { data: services = [] } = useAdminListServices();
  const { data: analytics } = useGetAnalytics();
  const { data: promos = [] } = useListSeasonalPromos();

  const updatePromo = useUpdateSeasonalPromo();
  const createPromo = useCreateSeasonalPromo();
  const deletePromo = useDeleteSeasonalPromo();
  const updateService = useAdminUpdateService();

  const invalidatePromos = () => queryClient.invalidateQueries({ queryKey: ["listSeasonalPromos"] });

  const handleTogglePromo = async (id: string, current: boolean) => {
    try {
      await updatePromo.mutateAsync({ data: { id, isActive: !current } as any });
      invalidatePromos();
      toast({ title: current ? "Promo deactivated" : "Promo activated" });
    } catch {
      toast({ variant: "destructive", title: "Update failed" });
    }
  };

  const handleCreatePromo = async () => {
    if (!newPromo.name.trim() || !newPromo.basePrice) {
      toast({ variant: "destructive", title: "Name and price are required" });
      return;
    }
    try {
      await createPromo.mutateAsync({
        data: {
          name: newPromo.name.trim(),
          basePrice: parseFloat(newPromo.basePrice),
          description: newPromo.description.trim() || undefined,
          validFrom: newPromo.validFrom || null,
          validTo: newPromo.validTo || null,
          includes: newPromo.includes ? newPromo.includes.split(",").map(s => s.trim()).filter(Boolean) : [],
          isActive: true,
        },
      });
      invalidatePromos();
      setNewPromo({ name: "", basePrice: "", description: "", validFrom: "", validTo: "", includes: "" });
      setShowCreatePromo(false);
      toast({ title: "Promo created" });
    } catch {
      toast({ variant: "destructive", title: "Failed to create promo" });
    }
  };

  const handleSaveEditPromo = async (id: string) => {
    try {
      await updatePromo.mutateAsync({
        data: {
          id,
          name: editPromo.name,
          basePrice: parseFloat(editPromo.basePrice),
          description: editPromo.description || undefined,
          validFrom: editPromo.validFrom || null,
          validTo: editPromo.validTo || null,
          includes: editPromo.includes ? editPromo.includes.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
        } as any,
      });
      invalidatePromos();
      setEditingPromoId(null);
      toast({ title: "Promo updated" });
    } catch {
      toast({ variant: "destructive", title: "Update failed" });
    }
  };

  const handleDeletePromo = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await deletePromo.mutateAsync({ id });
      invalidatePromos();
      toast({ title: "Promo deleted" });
    } catch {
      toast({ variant: "destructive", title: "Delete failed" });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === bookings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(bookings.map((b: any) => b.id)));
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!confirm(`Permanently delete ${ids.length} booking${ids.length !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBulkWorking(true);
    try {
      const res = await fetch("/api/admin/bookings/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["adminListBookings"] });
      setSelectedIds(new Set());
      toast({ title: `${data.deleted} booking${data.deleted !== 1 ? "s" : ""} deleted` });
    } catch {
      toast({ variant: "destructive", title: "Bulk delete failed" });
    } finally {
      setBulkWorking(false);
    }
  };

  const handleBulkStatus = async () => {
    if (!bulkStatus) return;
    const ids = Array.from(selectedIds);
    setBulkWorking(true);
    try {
      const res = await fetch("/api/admin/bookings/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, status: bulkStatus }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["adminListBookings"] });
      setSelectedIds(new Set());
      setBulkStatus("");
      toast({ title: `${data.updated} booking${data.updated !== 1 ? "s" : ""} set to ${bulkStatus}` });
    } catch {
      toast({ variant: "destructive", title: "Bulk status update failed" });
    } finally {
      setBulkWorking(false);
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
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-2 border-border text-muted-foreground hover:text-foreground"
          onClick={() => queryClient.invalidateQueries()}
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Revenue</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-primary">${analytics?.totalRevenue || 9800}</div></CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Bookings</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{analytics?.totalBookings ?? 0}</div></CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Pending</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-yellow-500">{analytics?.pendingBookings ?? 0}</div></CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Completed</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-green-500">{analytics?.completedBookings ?? 0}</div></CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="bg-surface border border-border mb-6">
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="promos">Seasonal</TabsTrigger>
        </TabsList>

        <TabsContent value="bookings">
          {/* Bookings tab header */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-muted-foreground">{bookings.length} booking{bookings.length !== 1 ? "s" : ""}</p>
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
              onClick={() => setShowManualBooking(true)}
            >
              <Plus className="h-4 w-4" />
              New Booking
            </Button>
          </div>

          {/* Bulk action toolbar — only visible when rows are selected */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 mb-3 px-4 py-3 bg-primary/10 border border-primary/30 rounded-lg">
              <span className="text-sm font-medium text-primary mr-1">
                {selectedIds.size} selected
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground h-7 px-2 text-xs"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </Button>
              <div className="flex-1" />
              {/* Status change */}
              <div className="flex items-center gap-2">
                <Select value={bulkStatus} onValueChange={setBulkStatus}>
                  <SelectTrigger className="h-8 text-xs w-[130px] bg-background border-border">
                    <SelectValue placeholder="Set status…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={!bulkStatus || bulkWorking}
                  onClick={handleBulkStatus}
                >
                  Apply
                </Button>
              </div>
              {/* Delete */}
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50"
                disabled={bulkWorking}
                onClick={handleBulkDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete {selectedIds.size}
              </Button>
            </div>
          )}

          <Card className="bg-surface border-border">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={bookings.length > 0 && selectedIds.size === bookings.length}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                      className="border-border"
                    />
                  </TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.map((b: any) => (
                  <TableRow
                    key={b.id}
                    className={`border-border ${selectedIds.has(b.id) ? "bg-primary/5" : ""}`}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(b.id)}
                        onCheckedChange={() => toggleSelect(b.id)}
                        aria-label="Select booking"
                        className="border-border"
                      />
                    </TableCell>
                    <TableCell className="text-sm">
                      {b.appointmentAt ? format(new Date(b.appointmentAt), "MMM d, yyyy") : "TBD"}
                    </TableCell>
                    <TableCell className="text-sm">{b.customer?.name}</TableCell>
                    <TableCell className="text-sm">{b.vehicle?.year} {b.vehicle?.model}</TableCell>
                    <TableCell className="text-sm max-w-[160px] truncate">{b.items?.[0]?.itemName || "Custom"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${SOURCE_BADGE_CLASS[b.source ?? "online"] ?? SOURCE_BADGE_CLASS.other}`}>
                        {SOURCE_LABELS[b.source ?? "online"] ?? b.source}
                      </Badge>
                    </TableCell>
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
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
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
          <div className="space-y-4">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{promos.length} promo{promos.length !== 1 ? "s" : ""} configured</p>
              <Button
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
                onClick={() => setShowCreatePromo(v => !v)}
              >
                <Plus className="h-4 w-4" />
                {showCreatePromo ? "Cancel" : "Add Promo"}
              </Button>
            </div>

            {/* Create form */}
            {showCreatePromo && (
              <Card className="bg-surface border-primary/30 border">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Tag className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">New Seasonal Promotion</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Name *</label>
                      <Input
                        placeholder="e.g. Spring Refresh Special"
                        value={newPromo.name}
                        onChange={e => setNewPromo(p => ({ ...p, name: e.target.value }))}
                        className="bg-surface-2 border-border"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Price ($) *</label>
                      <Input
                        type="number"
                        placeholder="e.g. 149"
                        value={newPromo.basePrice}
                        onChange={e => setNewPromo(p => ({ ...p, basePrice: e.target.value }))}
                        className="bg-surface-2 border-border"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-xs text-muted-foreground">Description</label>
                      <Input
                        placeholder="Short description shown to customers"
                        value={newPromo.description}
                        onChange={e => setNewPromo(p => ({ ...p, description: e.target.value }))}
                        className="bg-surface-2 border-border"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground flex items-center gap-1"><CalendarRange className="h-3 w-3" /> Valid From</label>
                      <Input
                        type="date"
                        value={newPromo.validFrom}
                        onChange={e => setNewPromo(p => ({ ...p, validFrom: e.target.value }))}
                        className="bg-surface-2 border-border"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground flex items-center gap-1"><CalendarRange className="h-3 w-3" /> Valid To</label>
                      <Input
                        type="date"
                        value={newPromo.validTo}
                        onChange={e => setNewPromo(p => ({ ...p, validTo: e.target.value }))}
                        className="bg-surface-2 border-border"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-xs text-muted-foreground">What's Included (comma-separated)</label>
                      <Input
                        placeholder="e.g. Exterior Wash, Interior Vacuum, Tire Shine"
                        value={newPromo.includes}
                        onChange={e => setNewPromo(p => ({ ...p, includes: e.target.value }))}
                        className="bg-surface-2 border-border"
                      />
                    </div>
                  </div>
                  <Button
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={handleCreatePromo}
                    disabled={createPromo.isPending}
                  >
                    {createPromo.isPending ? "Creating..." : "Create Promotion"}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Promo cards */}
            {promos.map((p: any) => (
              <Card key={p.id} className="bg-surface border-border">
                <CardContent className="p-6">
                  {editingPromoId === p.id ? (
                    /* Edit mode */
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Name</label>
                          <Input value={editPromo.name ?? ""} onChange={e => setEditPromo((ep: any) => ({ ...ep, name: e.target.value }))} className="bg-surface-2 border-border" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Price ($)</label>
                          <Input type="number" value={editPromo.basePrice ?? ""} onChange={e => setEditPromo((ep: any) => ({ ...ep, basePrice: e.target.value }))} className="bg-surface-2 border-border" />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-xs text-muted-foreground">Description</label>
                          <Input value={editPromo.description ?? ""} onChange={e => setEditPromo((ep: any) => ({ ...ep, description: e.target.value }))} className="bg-surface-2 border-border" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Valid From</label>
                          <Input type="date" value={editPromo.validFrom ?? ""} onChange={e => setEditPromo((ep: any) => ({ ...ep, validFrom: e.target.value }))} className="bg-surface-2 border-border" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Valid To</label>
                          <Input type="date" value={editPromo.validTo ?? ""} onChange={e => setEditPromo((ep: any) => ({ ...ep, validTo: e.target.value }))} className="bg-surface-2 border-border" />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-xs text-muted-foreground">Includes (comma-separated)</label>
                          <Input value={editPromo.includes ?? ""} onChange={e => setEditPromo((ep: any) => ({ ...ep, includes: e.target.value }))} className="bg-surface-2 border-border" />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" className="bg-primary text-primary-foreground" onClick={() => handleSaveEditPromo(p.id)} disabled={updatePromo.isPending}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingPromoId(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <h3 className="text-lg font-bold">{p.name}</h3>
                          <Badge variant="outline" className={p.isActive ? "text-green-500 border-green-500/20 bg-green-500/10" : "text-muted-foreground border-border"}>
                            {p.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        {p.description && <p className="text-muted-foreground text-sm mb-2">{p.description}</p>}
                        <p className="text-2xl font-bold text-primary mb-2">${Number(p.basePrice).toFixed(2)}</p>
                        {(p.validFrom || p.validTo) && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                            <CalendarRange className="h-3 w-3" />
                            {p.validFrom ?? "—"} → {p.validTo ?? "—"}
                          </p>
                        )}
                        {p.includes?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {p.includes.map((item: string, i: number) => (
                              <Badge key={i} variant="secondary" className="text-xs bg-surface-2 text-foreground">{item}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-3 shrink-0">
                        <div className="flex items-center gap-2">
                          <label className="text-sm text-muted-foreground">{p.isActive ? "Live" : "Off"}</label>
                          <Switch checked={p.isActive} onCheckedChange={() => handleTogglePromo(p.id, p.isActive)} />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 border-border hover:border-primary/40"
                            onClick={() => {
                              setEditingPromoId(p.id);
                              setEditPromo({
                                name: p.name,
                                basePrice: String(p.basePrice),
                                description: p.description ?? "",
                                validFrom: p.validFrom ?? "",
                                validTo: p.validTo ?? "",
                                includes: (p.includes ?? []).join(", "),
                              });
                            }}
                          >
                            <Pencil className="h-3 w-3" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 border-red-500/20 text-red-400 hover:border-red-500/40 hover:bg-red-500/10"
                            onClick={() => handleDeletePromo(p.id, p.name)}
                            disabled={deletePromo.isPending}
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            {promos.length === 0 && !showCreatePromo && (
              <Card className="bg-surface border-border">
                <CardContent className="p-12 text-center">
                  <Tag className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
                  <p className="text-muted-foreground mb-4">No seasonal promotions yet. Create one to show special deals to customers during booking.</p>
                  <Button size="sm" className="bg-primary text-primary-foreground" onClick={() => setShowCreatePromo(true)}>
                    <Plus className="h-4 w-4 mr-1" /> Create First Promo
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <BookingDetailSheet
        booking={selectedBooking}
        open={!!selectedBooking}
        onClose={() => setSelectedBooking(null)}
      />
      <ManualBookingSheet
        open={showManualBooking}
        onClose={() => setShowManualBooking(false)}
      />
    </div>
  );
}
