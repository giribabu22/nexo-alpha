/**
 * File uploads: bytes in a blob store, metadata in the document store, and
 * the HTTP API browsers need, from one call.
 *
 * ```ts
 * const files = createFiles({ store, blobs: createDiskBlobStore("data/files"), accept: ["image/*", "application/pdf"] });
 * app.module(files);   // POST /api/files, GET /api/files/:id, GET /api/files/:id/info, DELETE /api/files/:id
 *
 * const Profile = model("profiles", { photo: field.file({ accept: ["image/*"] }) });
 * ```
 *
 * Downloads are served defensively, since anyone may upload anything:
 * `X-Content-Type-Options: nosniff`, a sandboxing Content-Security-Policy,
 * and `Content-Disposition: attachment` for every type that is not known to
 * be safe to display (so an uploaded HTML or SVG file cannot run scripts on
 * your site). File ids are random UUIDs; without `auth.read`, anyone with a
 * file's URL can download it.
 *
 * Cleanup: `resource()` records which record uses each file (`field.file()`)
 * and releases a file when the record replaces or deletes it. Released files
 * are removed an hour later, by a timer that runs while the app is started.
 * Files that were uploaded but never used by a record are kept unless you set
 * `cleanup.removeUnattachedAfterMs` — set it when every file reference goes
 * through `resource()` (or `files.attach`), since other references are invisible.
 */

import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { httpResponse, type NexoApi, type NexoApiAuth, type NexoRequestContext } from "./api.js";
import { NexoConfigurationError, NexoHttpError } from "./errors.js";
import { FILES_PATH, mimeMatches, type NexoFile } from "./files-contract.js";
import type { NexoModule } from "./module.js";
import type { ResourceAuth } from "./resource.js";
import type { NexoDocumentStore } from "./storage.js";
import { FILES_COLLECTION, attachFile, detachFile } from "./file-attachments.js";

// ---------------------------------------------------------------------------
// Blob stores
// ---------------------------------------------------------------------------

/** Where file contents live. Keys are file ids. */
export interface NexoBlobStore {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  /** Returns false if there was nothing to delete. */
  delete(key: string): Promise<boolean>;
}

const BLOB_KEY = /^[A-Za-z0-9_-]{1,128}$/;

function assertKey(key: string): void {
  if (!BLOB_KEY.test(key)) throw new NexoConfigurationError(`Invalid blob key "${key}".`);
}

export function createInMemoryBlobStore(): NexoBlobStore {
  const blobs = new Map<string, Uint8Array>();
  return {
    async put(key, data) {
      assertKey(key);
      blobs.set(key, new Uint8Array(data));
    },
    async get(key) {
      assertKey(key);
      const data = blobs.get(key);
      return data === undefined ? undefined : new Uint8Array(data);
    },
    async delete(key) {
      assertKey(key);
      return blobs.delete(key);
    }
  };
}

/**
 * One file per blob under `directory`. Keys are restricted to letters,
 * digits, "-" and "_", so they can never point outside it. Writes go to a
 * temporary file first and are renamed into place.
 */
export function createDiskBlobStore(directory: string): NexoBlobStore {
  const fileFor = (key: string): string => {
    assertKey(key);
    return path.join(directory, key);
  };
  return {
    async put(key, data) {
      const target = fileFor(key);
      await fs.mkdir(directory, { recursive: true });
      const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
      await fs.writeFile(temp, data);
      await fs.rename(temp, target);
    },
    async get(key) {
      try {
        return new Uint8Array(await fs.readFile(fileFor(key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },
    async delete(key) {
      try {
        await fs.unlink(fileFor(key));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Files module
// ---------------------------------------------------------------------------

export interface CreateFilesOptions {
  /** Holds file metadata (collection "files"); use the same store as the resources that reference files. */
  readonly store: NexoDocumentStore;
  readonly blobs: NexoBlobStore;
  /** Default: "/api/files" */
  readonly path?: string;
  /** Largest upload in bytes. Default: 10 MB */
  readonly maxBytes?: number;
  /** Allowed MIME types, e.g. ["image/*", "application/pdf"]. Default: any. */
  readonly accept?: readonly string[];
  /** Like `resource()`: `true`, or scopes for `read` (download, info) and `write` (upload, delete). */
  readonly auth?: boolean | ResourceAuth;
  /** Removing files nothing uses any more; `false` turns the timer off (`sweep()` still works). */
  readonly cleanup?: FilesCleanupOptions | false;
}

export interface FilesCleanupOptions {
  /** Remove a file this long after its record released it. Default: 1 hour */
  readonly removeDetachedAfterMs?: number;
  /** Remove a file no record ever used, this long after upload. Default: never (see above). */
  readonly removeUnattachedAfterMs?: number;
  /** How often the timer sweeps while the app is started. Default: 15 minutes */
  readonly everyMs?: number;
}

export interface UploadInput {
  readonly name?: string | undefined;
  readonly type?: string | undefined;
  readonly uploadedBy?: string | undefined;
}

export interface NexoFiles extends NexoModule {
  readonly apis: readonly NexoApi[];
  readonly path: string;
  /** Stores a file. Throws 413 if too large, 415 if the type is not accepted, 400 if empty. */
  upload(data: Uint8Array, input?: UploadInput): Promise<NexoFile>;
  info(id: string): Promise<NexoFile | undefined>;
  /** Metadata and content, or undefined if there is no such file. */
  read(id: string): Promise<{ readonly file: NexoFile; readonly data: Uint8Array } | undefined>;
  /** Throws 404 if there is no such file. */
  delete(id: string): Promise<void>;
  /** Marks a file as used by `owner` (e.g. "invoices/42") when your own code stores the reference. */
  attach(id: string, owner: string): Promise<void>;
  /** Releases a file so cleanup can remove it. */
  detach(id: string, owner?: string): Promise<void>;
  /** Removes files nothing uses any more, per `cleanup`. Returns the removed ids. */
  sweep(now?: number): Promise<string[]>;
}

const COLLECTION = FILES_COLLECTION;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/** Types browsers display without running scripts; everything else is downloaded. */
const INLINE_TYPES = [
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
  "application/pdf", "text/plain", "audio/*", "video/*"
];

/** The last path segment, without control characters, at most 200 characters. */
function cleanName(name: string | undefined): string {
  const base = (name ?? "").split(/[/\\]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 200);
  return clean === "" || clean === "." || clean === ".." ? "file" : clean;
}

function cleanType(type: string | undefined): string {
  const main = (type ?? "").split(";")[0]!.trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(main) ? main : "application/octet-stream";
}

export function createFiles(options: CreateFilesOptions): NexoFiles {
  const { store, blobs } = options;
  const base = (options.path ?? FILES_PATH).replace(/\/+$/, "");
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  async function upload(data: Uint8Array, input: UploadInput = {}): Promise<NexoFile> {
    if (data.byteLength === 0) throw new NexoHttpError(400, "EMPTY_FILE", "The file is empty.");
    if (data.byteLength > maxBytes) throw new NexoHttpError(413, "FILE_TOO_LARGE", `Files may be at most ${maxBytes} bytes.`);
    const type = cleanType(input.type);
    if (options.accept !== undefined && !mimeMatches(type, options.accept)) {
      throw new NexoHttpError(415, "UNSUPPORTED_FILE_TYPE", `Files of type ${type} are not accepted (allowed: ${options.accept.join(", ")}).`);
    }
    const id = randomUUID();
    const file: NexoFile = {
      id,
      name: cleanName(input.name),
      type,
      size: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
      url: `${base}/${id}`,
      ...(input.uploadedBy !== undefined ? { uploadedBy: input.uploadedBy } : {}),
      createdAt: new Date().toISOString()
    };
    // Content first: metadata never points at missing bytes.
    await blobs.put(id, data);
    await store.put(COLLECTION, id, file);
    return file;
  }

  async function info(id: string): Promise<NexoFile | undefined> {
    return BLOB_KEY.test(id) ? store.get<NexoFile>(COLLECTION, id) : undefined;
  }

  async function read(id: string): Promise<{ file: NexoFile; data: Uint8Array } | undefined> {
    const file = await info(id);
    if (file === undefined) return undefined;
    const data = await blobs.get(id);
    return data === undefined ? undefined : { file, data };
  }

  async function remove(id: string): Promise<void> {
    if (!BLOB_KEY.test(id) || !(await store.delete(COLLECTION, id))) {
      throw new NexoHttpError(404, "NOT_FOUND", `File "${id}" not found.`);
    }
    await blobs.delete(id);
  }

  function authFor(group: "read" | "write"): { auth?: NexoApiAuth } {
    if (options.auth === undefined || options.auth === false) return {};
    if (options.auth === true) return { auth: { required: true } };
    const scopes = options.auth[group];
    return scopes === undefined ? {} : { auth: { required: true, scopes } };
  }

  const cleanup = options.cleanup === false ? undefined : options.cleanup ?? {};
  const removeDetachedAfterMs = cleanup?.removeDetachedAfterMs ?? 60 * 60 * 1000;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function sweep(now = Date.now()): Promise<string[]> {
    const removed: string[] = [];
    for (const file of await store.list<NexoFile>(COLLECTION)) {
      if (file.attachedTo !== undefined) continue;
      const due = file.detachedAt !== undefined
        ? Date.parse(file.detachedAt) + removeDetachedAfterMs
        : cleanup?.removeUnattachedAfterMs !== undefined
          ? Date.parse(file.createdAt) + cleanup.removeUnattachedAfterMs
          : Number.POSITIVE_INFINITY;
      if (due > now) continue;
      // Only if still unused: it may have been attached since it was listed.
      if (await store.replaceIf(COLLECTION, file.id, file, { ...file, detachedAt: file.detachedAt ?? file.createdAt, removing: true })) {
        await blobs.delete(file.id);
        await store.delete(COLLECTION, file.id);
        removed.push(file.id);
      }
    }
    return removed;
  }

  const notFound = (id: string) => new NexoHttpError(404, "NOT_FOUND", `File "${id}" not found.`);
  const uploader = (context: NexoRequestContext): string | undefined => {
    const sub = (context.auth?.identity as { sub?: unknown } | undefined)?.sub;
    return typeof sub === "string" ? sub : undefined;
  };

  const apis: NexoApi[] = [
    {
      name: "files.upload",
      method: "POST",
      path: base,
      description: "Upload a file: the request body is the file, Content-Type its type, ?name= its name. Answers 201 with its metadata.",
      rawBody: { maxBytes },
      ...authFor("write"),
      handler: async (context) => {
        const data = context.payload instanceof Uint8Array ? context.payload : new Uint8Array(0);
        const name = typeof context.query.name === "string" ? context.query.name : undefined;
        const file = await upload(data, { name, type: context.headers["content-type"], uploadedBy: uploader(context) });
        return httpResponse(201, file, { location: file.url });
      }
    },
    {
      name: "files.download",
      method: "GET",
      path: `${base}/:id`,
      description: "The file's content.",
      ...authFor("read"),
      handler: async (context) => {
        const found = await read(context.params.id!);
        if (found === undefined) throw notFound(context.params.id!);
        const { file, data } = found;
        const disposition = mimeMatches(file.type, INLINE_TYPES) ? "inline" : "attachment";
        return httpResponse(200, Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
          "content-type": file.type,
          "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          "cache-control": "private, max-age=31536000, immutable",
          etag: `"${file.sha256}"`
        });
      }
    },
    {
      name: "files.info",
      method: "GET",
      path: `${base}/:id/info`,
      description: "The file's metadata.",
      ...authFor("read"),
      handler: async (context) => {
        const file = await info(context.params.id!);
        if (file === undefined) throw notFound(context.params.id!);
        return file;
      }
    },
    {
      name: "files.delete",
      method: "DELETE",
      path: `${base}/:id`,
      description: "Delete a file.",
      ...authFor("write"),
      handler: async (context) => {
        await remove(context.params.id!);
        return undefined;
      }
    }
  ];

  return {
    name: "files",
    description: "File uploads and downloads.",
    purpose: `Stores uploaded files and serves them at ${base}.`,
    apis,
    path: base,
    upload,
    info,
    read,
    delete: remove,
    attach: (id, owner) => attachFile(store, id, owner),
    detach: (id, owner) => detachFile(store, id, owner),
    sweep,
    start() {
      if (cleanup === undefined || timer !== undefined) return;
      timer = setInterval(() => void sweep().catch(() => undefined), cleanup.everyMs ?? 15 * 60 * 1000);
      timer.unref?.();
    },
    stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    }
  };
}
