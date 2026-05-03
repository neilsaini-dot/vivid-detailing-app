// Google Drive — standard OAuth 2.0 via GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
import { googleFetch } from "./googleAuth";
import { randomUUID } from "crypto";

const ROOT_FOLDER_NAME = "Vivid Detailing - Client Photos";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

interface DriveFile {
  id: string;
  name: string;
  webViewLink?: string;
}

interface DriveListResponse {
  files: DriveFile[];
}

async function driveJson<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await googleFetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive API ${init.method ?? "GET"} ${url} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function findOrCreateFolder(name: string, parentId?: string): Promise<DriveFile> {
  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `mimeType = '${FOLDER_MIME}'`,
    "trashed = false",
    parentId ? `'${parentId}' in parents` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  const list = await driveJson<DriveListResponse>(
    `${DRIVE_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&spaces=drive`
  );
  if (list.files.length > 0) return list.files[0];

  const metadata: Record<string, unknown> = { name, mimeType: FOLDER_MIME };
  if (parentId) metadata.parents = [parentId];

  return driveJson<DriveFile>(`${DRIVE_BASE}/files?fields=id,name,webViewLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
}

async function uploadFileToDrive(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  parentId: string
): Promise<DriveFile> {
  const boundary = `boundary_${randomUUID().replace(/-/g, "")}`;
  const metadata = JSON.stringify({ name: fileName, parents: [parentId] });

  const prelude = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    "utf-8"
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--`, "utf-8");
  const body = Buffer.concat([prelude, fileBuffer, epilogue]);

  const res = await googleFetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,webViewLink`,
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body: body as unknown as BodyInit,
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive upload failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<DriveFile>;
}

export interface SyncPhotosResult {
  folderUrl: string;
  uploaded: { before: number; after: number };
}

export async function syncPhotosToGoogleDrive({
  customerName,
  bookingDate,
  beforeBuffers,
  afterBuffers,
}: {
  customerName: string;
  bookingDate: string;        // e.g. "2026-05-03"
  beforeBuffers: Array<{ name: string; data: Buffer; mimeType: string }>;
  afterBuffers: Array<{ name: string; data: Buffer; mimeType: string }>;
}): Promise<SyncPhotosResult> {
  // 1. Root "Vivid Detailing - Client Photos"
  const root = await findOrCreateFolder(ROOT_FOLDER_NAME);

  // 2. Customer subfolder
  const customerFolder = await findOrCreateFolder(customerName, root.id);

  // 3. Date subfolder inside customer folder
  const dateFolder = await findOrCreateFolder(bookingDate, customerFolder.id);

  // 4. Before / After subfolders
  const [beforeFolder, afterFolder] = await Promise.all([
    findOrCreateFolder("Before", dateFolder.id),
    findOrCreateFolder("After", dateFolder.id),
  ]);

  // 5. Upload files
  const uploadAll = async (
    buffers: typeof beforeBuffers,
    folderId: string
  ): Promise<number> => {
    let count = 0;
    for (const f of buffers) {
      await uploadFileToDrive(f.data, f.name, f.mimeType, folderId);
      count++;
    }
    return count;
  };

  const [beforeCount, afterCount] = await Promise.all([
    uploadAll(beforeBuffers, beforeFolder.id),
    uploadAll(afterBuffers, afterFolder.id),
  ]);

  const folderUrl =
    dateFolder.webViewLink ??
    `https://drive.google.com/drive/folders/${dateFolder.id}`;

  return { folderUrl, uploaded: { before: beforeCount, after: afterCount } };
}
