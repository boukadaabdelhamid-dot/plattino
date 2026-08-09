import { Storage } from "@google-cloud/storage";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Readable, PassThrough } from "stream";
import { randomUUID } from "crypto";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// Persistent fallback directory for local disk storage, used when neither a GCS
// service account nor Replit Object Storage bucket paths are configured. Lives
// inside the working directory (the workspace in Replit dev) so it survives
// restarts and does not require any environment configuration.
const DEFAULT_LOCAL_STORAGE_PATH = path.resolve(process.cwd(), ".uploads");

export type { ObjectAclPolicy, ObjectPermission } from "./objectAcl";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export interface StorageFile {
  exists(): Promise<[boolean]>;
  createReadStream(): NodeJS.ReadableStream;
  getMetadata(): Promise<[{ contentType?: string; size?: number | string }]>;
  save(buffer: Buffer, options: { contentType: string; resumable?: boolean }): Promise<void>;
}

/**
 * Resolve a user-supplied sub-path under a known root and reject any
 * attempt to escape the root via ".." segments or absolute paths.
 */
function safeJoin(root: string, userPath: string): string {
  // Strip leading slashes to prevent path.join treating it as absolute
  const stripped = userPath.replace(/^[/\\]+/, "");
  const resolved = path.resolve(root, stripped);
  const normalizedRoot = path.resolve(root);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw Object.assign(
      new Error("Path traversal attempt rejected"),
      { statusCode: 400 }
    );
  }
  return resolved;
}

/**
 * LocalFile: persists file data + content-type (in a ".meta" sidecar).
 * Reconstructs content-type on retrieval so images are served correctly.
 */
class LocalFile implements StorageFile {
  private readonly metaPath: string;

  constructor(private readonly filePath: string) {
    this.metaPath = filePath + ".meta";
  }

  async exists(): Promise<[boolean]> {
    try {
      await fsPromises.access(this.filePath);
      return [true];
    } catch {
      return [false];
    }
  }

  createReadStream(): NodeJS.ReadableStream {
    return fs.createReadStream(this.filePath);
  }

  async getMetadata(): Promise<[{ contentType?: string; size?: number | string }]> {
    const stat = await fsPromises.stat(this.filePath);
    let contentType = "application/octet-stream";
    try {
      const meta = await fsPromises.readFile(this.metaPath, "utf8");
      const parsed = JSON.parse(meta) as { contentType?: string };
      if (parsed.contentType) contentType = parsed.contentType;
    } catch {
      // No sidecar — default MIME
    }
    return [{ contentType, size: stat.size }];
  }

  async save(buffer: Buffer, options: { contentType: string }): Promise<void> {
    await fsPromises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fsPromises.writeFile(this.filePath, buffer);
    await fsPromises.writeFile(this.metaPath, JSON.stringify({ contentType: options.contentType }));
  }
}

/**
 * R2File: wraps a single Cloudflare R2 object as a StorageFile.
 * R2 is S3-compatible; we use @aws-sdk/client-s3 with a custom endpoint.
 */
class R2File implements StorageFile {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly key: string,
  ) {}

  async exists(): Promise<[boolean]> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key }));
      return [true];
    } catch {
      return [false];
    }
  }

  createReadStream(): NodeJS.ReadableStream {
    const pass = new PassThrough();
    this.client
      .send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key }))
      .then((response) => {
        const body = response.Body;
        if (!body) {
          pass.destroy(new ObjectNotFoundError());
          return;
        }
        // In Node.js, AWS SDK v3 Body is a Readable stream
        (body as unknown as NodeJS.ReadableStream).pipe(pass);
      })
      .catch((err: Error) => pass.destroy(err));
    return pass;
  }

  async getMetadata(): Promise<[{ contentType?: string; size?: number | string }]> {
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: this.key })
    );
    return [{ contentType: response.ContentType, size: response.ContentLength }];
  }

  async save(buffer: Buffer, options: { contentType: string }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key,
        Body: buffer,
        ContentType: options.contentType,
      })
    );
  }
}

type StorageMode = "gcs" | "replit" | "r2" | "local";

function detectStorageMode(): StorageMode {
  // Explicit GCS service account — Railway production with a GCS bucket.
  if (process.env.GOOGLE_CREDENTIALS_JSON) return "gcs";
  // Replit-managed Object Storage — only when the bucket paths are configured.
  // REPL_ID alone is NOT sufficient: without PRIVATE_OBJECT_DIR and
  // PUBLIC_OBJECT_SEARCH_PATHS the GCS-backed code path cannot resolve a bucket
  // and uploadBuffer() would throw. In that case we fall through to local disk
  // storage so uploads keep working in Replit dev without any extra config.
  if (
    (process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN) &&
    process.env.PRIVATE_OBJECT_DIR &&
    process.env.PUBLIC_OBJECT_SEARCH_PATHS
  ) {
    return "replit";
  }
  // Cloudflare R2 — S3-compatible object storage.
  if (
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  ) {
    return "r2";
  }
  // Everything else uses local disk storage. An explicit STORAGE_LOCAL_PATH
  // (e.g. a Railway Volume) is honoured by getLocalBase(); otherwise a
  // persistent default path is used so uploads always work.
  return "local";
}

let _mode: StorageMode | undefined;
let _gcsClient: Storage | undefined;
let _r2Client: S3Client | undefined;

function getMode(): StorageMode {
  if (!_mode) _mode = detectStorageMode();
  return _mode;
}

function getGcsClient(): Storage {
  if (!_gcsClient) {
    const mode = getMode();
    if (mode === "gcs") {
      const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON!) as object;
      _gcsClient = new Storage({ credentials });
    } else if (mode === "replit") {
      _gcsClient = new Storage({
        credentials: {
          audience: "replit",
          subject_token_type: "access_token",
          token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
          type: "external_account",
          credential_source: {
            url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
            format: {
              type: "json",
              subject_token_field_name: "access_token",
            },
          },
          universe_domain: "googleapis.com",
        },
        projectId: "",
      });
    } else {
      throw new Error("GCS client not available in this storage mode");
    }
  }
  return _gcsClient;
}

function getR2Client(): S3Client {
  if (!_r2Client) {
    const accountId = process.env.R2_ACCOUNT_ID!;
    _r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return _r2Client;
}

function getR2Bucket(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME is not set");
  return bucket;
}

function getLocalBase(): string {
  const p = process.env.STORAGE_LOCAL_PATH || DEFAULT_LOCAL_STORAGE_PATH;
  return path.resolve(p);
}

/** Resolved storage mode for the current process (for logging/diagnostics). */
export function getStorageMode(): StorageMode {
  return getMode();
}

/** Absolute base directory used in local storage mode (throws in other modes). */
export function getLocalStorageBase(): string {
  return getLocalBase();
}

/**
 * Create the local storage directories up-front so the first upload never races
 * on directory creation. No-op when not in local mode. Safe to call on startup.
 */
export async function ensureLocalStorageReady(): Promise<void> {
  if (getMode() !== "local") return;
  const base = getLocalBase();
  await fsPromises.mkdir(path.join(base, "private", "uploads"), { recursive: true });
  await fsPromises.mkdir(path.join(base, "public"), { recursive: true });
}

/**
 * Public base URL prepended to served image URLs.
 *
 * In R2 mode: if R2_PUBLIC_URL is set, images are served directly from the R2
 * public bucket domain (e.g. https://pub-xxx.r2.dev or a custom domain). Otherwise
 * images fall back to the API proxy route (/api/uploads/:id) which downloads from R2.
 *
 * In other modes: PUBLIC_ASSET_BASE_URL overrides with a CDN/custom domain; otherwise
 * we use a relative URL so stored paths never go stale when the dev domain changes.
 */
function getPublicBaseUrl(): string {
  const mode = getMode();
  if (mode === "r2") {
    const r2PublicUrl = process.env.R2_PUBLIC_URL;
    if (r2PublicUrl) return r2PublicUrl.replace(/\/+$/, "");
    // No public URL configured — fall back to the API proxy path
  }
  if (process.env.PUBLIC_ASSET_BASE_URL) {
    return process.env.PUBLIC_ASSET_BASE_URL.replace(/\/+$/, "");
  }
  // Always relative — never bake a dev domain into stored URLs.
  return "";
}

function buildPublicUrl(objectId: string): string {
  const mode = getMode();
  if (mode === "r2" && process.env.R2_PUBLIC_URL) {
    // Direct R2 public URL: <R2_PUBLIC_URL>/uploads/<uuid>
    return `${getPublicBaseUrl()}/uploads/${objectId}`;
  }
  // API proxy path (works for all modes including R2 without public URL)
  return `${getPublicBaseUrl()}/api/uploads/${objectId}`;
}

function parseObjectPath(p: string): { bucketName: string; objectName: string } {
  if (!p.startsWith("/")) p = `/${p}`;
  const parts = p.split("/");
  if (parts.length < 3) throw new Error("Invalid path: must contain at least a bucket name");
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const mode = getMode();
  if (mode === "gcs") {
    const file = getGcsClient().bucket(bucketName).file(objectName);
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: method === "PUT" ? "write" : method === "DELETE" ? "delete" : "read",
      expires: Date.now() + ttlSec * 1000,
    });
    return url;
  }
  if (mode === "replit") {
    const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: objectName,
        method,
        expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Failed to sign object URL: ${response.status}`);
    const json = await response.json() as { signed_url: string };
    return json.signed_url;
  }
  throw new Error(
    "Signed URLs are not supported in this storage mode. Use POST /api/uploads directly."
  );
}

export class ObjectStorageService {
  getPublicObjectSearchPaths(): string[] {
    const mode = getMode();
    if (mode === "local") return [path.join(getLocalBase(), "public")];
    if (mode === "r2") return []; // R2 public objects served directly via R2_PUBLIC_URL
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(pathsStr.split(",").map(p => p.trim()).filter(p => p.length > 0))
    );
    if (paths.length === 0) throw new Error("PUBLIC_OBJECT_SEARCH_PATHS not set.");
    return paths;
  }

  getPrivateObjectDir(): string {
    const mode = getMode();
    if (mode === "local") return path.join(getLocalBase(), "private");
    if (mode === "r2") return `/r2-uploads`; // Logical prefix, not used in GCS path parsing
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set.");
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<StorageFile | null> {
    const mode = getMode();
    if (mode === "local") {
      const root = path.join(getLocalBase(), "public");
      let resolved: string;
      try { resolved = safeJoin(root, filePath); } catch { return null; }
      const f = new LocalFile(resolved);
      const [exists] = await f.exists();
      return exists ? f : null;
    }
    if (mode === "r2") {
      // Public objects in R2 are served directly via R2_PUBLIC_URL — no search needed
      const key = `public/${filePath.replace(/^\/+/, "")}`;
      const file = new R2File(getR2Client(), getR2Bucket(), key);
      const [exists] = await file.exists();
      return exists ? file : null;
    }
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const file = getGcsClient().bucket(bucketName).file(objectName);
      const [exists] = await file.exists();
      if (exists) return file as unknown as StorageFile;
    }
    return null;
  }

  async downloadObject(file: StorageFile, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `public, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) headers["Content-Length"] = String(metadata.size);
    return new Response(webStream, { headers });
  }

  async uploadBuffer(
    buffer: Buffer,
    contentType: string,
  ): Promise<{ objectPath: string; publicUrl: string }> {
    const objectId = randomUUID();
    const mode = getMode();

    if (mode === "local") {
      const root = path.join(getLocalBase(), "private", "uploads");
      // objectId is a UUID — no traversal risk, but still validate with safeJoin
      const filePath = safeJoin(root, objectId);
      const f = new LocalFile(filePath);
      await f.save(buffer, { contentType });
      return { objectPath: `/objects/uploads/${objectId}`, publicUrl: buildPublicUrl(objectId) };
    }

    if (mode === "r2") {
      const key = `uploads/${objectId}`;
      const file = new R2File(getR2Client(), getR2Bucket(), key);
      await file.save(buffer, { contentType });
      return { objectPath: `/objects/uploads/${objectId}`, publicUrl: buildPublicUrl(objectId) };
    }

    // GCS / Replit
    const privateObjectDir = this.getPrivateObjectDir();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const file = getGcsClient().bucket(bucketName).file(objectName);
    await file.save(buffer, { contentType, resumable: false });
    return { objectPath: `/objects/uploads/${objectId}`, publicUrl: buildPublicUrl(objectId) };
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const mode = getMode();
    if (mode === "local" || mode === "r2") {
      throw new Error(
        "Signed upload URLs are not supported in this storage mode. Use POST /api/uploads instead."
      );
    }
    const objectId = randomUUID();
    const privateObjectDir = this.getPrivateObjectDir();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    return signObjectURL({ bucketName, objectName, method: "PUT", ttlSec: 900 });
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) return rawPath;
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) objectEntityDir = `${objectEntityDir}/`;
    if (!rawObjectPath.startsWith(objectEntityDir)) return rawObjectPath;
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<StorageFile> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) throw new ObjectNotFoundError();
    const entityId = parts.slice(1).join("/");
    const mode = getMode();

    if (mode === "local") {
      const root = path.join(getLocalBase(), "private");
      let filePath: string;
      try { filePath = safeJoin(root, entityId); } catch { throw new ObjectNotFoundError(); }
      const f = new LocalFile(filePath);
      const [exists] = await f.exists();
      if (!exists) throw new ObjectNotFoundError();
      return f;
    }

    if (mode === "r2") {
      // entityId = "uploads/<uuid>" — maps directly to the R2 key
      const file = new R2File(getR2Client(), getR2Bucket(), entityId);
      const [exists] = await file.exists();
      if (!exists) throw new ObjectNotFoundError();
      return file;
    }

    // GCS / Replit
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const objectFile = getGcsClient().bucket(bucketName).file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) throw new ObjectNotFoundError();
    return objectFile as unknown as StorageFile;
  }
}
