// Supabase Storage — replaces Replit object storage (127.0.0.1:1106)
// Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role bypasses RLS).
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

export const BUCKET = "client-photos";

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Sanitise a filename — keep extension, strip unsafe chars. */
function sanitiseName(name: string): string {
  const ext = name.includes(".") ? `.${name.split(".").pop()}` : "";
  const base = name
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 60);
  return `${base}${ext}`;
}

export interface UploadUrlResult {
  /** Presigned URL the client should PUT the file to. */
  signedUrl: string;
  /** Storage path within the bucket (stored in DB). */
  storagePath: string;
  /** Full public CDN URL ready to use as an <img> src. */
  publicUrl: string;
}

/**
 * Create a signed upload URL.
 * Path: {customerId}/{bookingId}/{photoType}/{uuid}-{sanitisedName}
 * Signature path: {customerId}/{bookingId}/signature/signature.png (no UUID)
 */
export async function createSignedUploadUrl(
  customerId: string,
  bookingId: string,
  photoType: "before" | "after" | "signature" | "inspection",
  originalName: string
): Promise<UploadUrlResult> {
  const supabase = getClient();
  const storagePath = photoType === "signature"
    ? `${customerId}/${bookingId}/signature/signature.png`
    : `${customerId}/${bookingId}/${photoType}/${randomUUID()}-${sanitiseName(originalName)}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    throw new Error(`Supabase upload URL error: ${error?.message ?? "unknown"}`);
  }

  const { data: pubData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

  return {
    signedUrl: data.signedUrl,
    storagePath,
    publicUrl: pubData.publicUrl,
  };
}

/**
 * Download a file from Supabase Storage into a Buffer.
 * Accepts either a full public URL or a bare storage path.
 */
export async function downloadFile(urlOrPath: string): Promise<{ data: Buffer; contentType: string }> {
  // If it's a full URL just fetch it directly (public bucket)
  if (urlOrPath.startsWith("http")) {
    const res = await fetch(urlOrPath);
    if (!res.ok) throw new Error(`Failed to download ${urlOrPath}: ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    return { data: Buffer.from(arrayBuf), contentType };
  }

  // Bare storage path
  const supabase = getClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(urlOrPath);
  if (error || !data) throw new Error(`Supabase download error: ${error?.message ?? "unknown"}`);
  const arrayBuf = await data.arrayBuffer();
  return { data: Buffer.from(arrayBuf), contentType: data.type || "application/octet-stream" };
}
