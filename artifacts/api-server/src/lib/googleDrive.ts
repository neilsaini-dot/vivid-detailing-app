// Google Drive integration via @replit/connectors-sdk
// Uses the proxy pattern — never cache connectors instance (tokens expire)
import { ReplitConnectors } from "@replit/connectors-sdk";
import { randomUUID } from "crypto";

const CONNECTOR = "google-drive";
const ROOT_FOLDER_NAME = "Vivid Detailing";
const FOLDER_MIME = "application/vnd.google-apps.folder";

function makeConnectors() {
  return new ReplitConnectors();
}

async function driveJson<T = unknown>(
  connectors: ReplitConnectors,
  path: string,
  options: Parameters<ReplitConnectors["proxy"]>[2] = {}
): Promise<T> {
  const res = await connectors.proxy(CONNECTOR, path, options);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive API ${options.method ?? "GET"} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

interface DriveFile {
  id: string;
  name: string;
  webViewLink?: string;
}

interface DriveListResponse {
  files: DriveFile[];
}

async function findOrCreateFolder(
  connectors: ReplitConnectors,
  name: string,
  parentId?: string
): Promise<DriveFile> {
  // Search for existing folder
  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `mimeType = '${FOLDER_MIME}'`,
    "trashed = false",
    parentId ? `'${parentId}' in parents` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  const list = await driveJson<DriveListResponse>(
    connectors,
    `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&spaces=drive`
  );

  if (list.files.length > 0) return list.files[0];

  // Create it
  const metadata: Record<string, unknown> = {
    name,
    mimeType: FOLDER_MIME,
  };
  if (parentId) metadata.parents = [parentId];

  return driveJson<DriveFile>(connectors, `/drive/v3/files?fields=id,name,webViewLink`, {
    method: "POST",
    body: JSON.stringify(metadata),
    headers: { "Content-Type": "application/json" },
  });
}

async function uploadFileToDrive(
  connectors: ReplitConnectors,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  parentId: string
): Promise<DriveFile> {
  const boundary = `boundary_${randomUUID().replace(/-/g, "")}`;
  const metadata = JSON.stringify({ name: fileName, parents: [parentId] });

  const parts = [
    `--${boundary}\r\n`,
    `Content-Type: application/json; charset=UTF-8\r\n\r\n`,
    `${metadata}\r\n`,
    `--${boundary}\r\n`,
    `Content-Type: ${mimeType}\r\n\r\n`,
  ];

  const prelude = Buffer.from(parts.join(""), "utf-8");
  const epilogue = Buffer.from(`\r\n--${boundary}--`, "utf-8");
  const body = Buffer.concat([prelude, fileBuffer, epilogue]);

  const res = await connectors.proxy(
    CONNECTOR,
    `/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink`,
    {
      method: "POST",
      body: body as unknown as BodyInit,
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
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
  bookingLabel,
  beforeBuffers,
  afterBuffers,
}: {
  bookingLabel: string;
  beforeBuffers: Array<{ name: string; data: Buffer; mimeType: string }>;
  afterBuffers: Array<{ name: string; data: Buffer; mimeType: string }>;
}): Promise<SyncPhotosResult> {
  // Never cache — tokens expire
  const connectors = makeConnectors();

  // 1. Root "Vivid Detailing" folder
  const root = await findOrCreateFolder(connectors, ROOT_FOLDER_NAME);

  // 2. Booking subfolder
  const bookingFolder = await findOrCreateFolder(connectors, bookingLabel, root.id);

  // 3. Before / After subfolders
  const [beforeFolder, afterFolder] = await Promise.all([
    findOrCreateFolder(connectors, "Before", bookingFolder.id),
    findOrCreateFolder(connectors, "After", bookingFolder.id),
  ]);

  // 4. Upload files
  const uploadAll = async (
    buffers: typeof beforeBuffers,
    folderId: string
  ) => {
    let count = 0;
    for (const f of buffers) {
      await uploadFileToDrive(connectors, f.data, f.name, f.mimeType, folderId);
      count++;
    }
    return count;
  };

  const [beforeCount, afterCount] = await Promise.all([
    uploadAll(beforeBuffers, beforeFolder.id),
    uploadAll(afterBuffers, afterFolder.id),
  ]);

  const folderUrl =
    bookingFolder.webViewLink ??
    `https://drive.google.com/drive/folders/${bookingFolder.id}`;

  return {
    folderUrl,
    uploaded: { before: beforeCount, after: afterCount },
  };
}
