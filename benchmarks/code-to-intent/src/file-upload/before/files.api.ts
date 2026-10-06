import { NexoHttpError, httpResponse, type NexoDocumentStore, type NexoModule } from "@nexo-alpha/core";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

interface StoredFile {
  id: string;
  name: string;
  type: string;
  size: number;
  sha256: string;
  url: string;
  createdAt: string;
}

const MAX_BYTES = 1024 * 1024;
const ACCEPTED = /^(image\/[\w.+-]+|application\/pdf|text\/plain)$/;
const SHOW_INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/;

// Handlers only receive parsed JSON, so the file arrives base64-encoded.
export function modules(store: NexoDocumentStore, directory: string): NexoModule[] {
  return [
    {
      name: "files",
      apis: [
        {
          name: "uploadFile",
          method: "POST",
          path: "/api/files",
          schema: {
            body: {
              type: "object",
              required: ["name", "type", "data"],
              properties: { name: { type: "string" }, type: { type: "string" }, data: { type: "string" } }
            }
          },
          handler: async (context) => {
            const body = context.payload as { name: string; type: string; data: string };
            const bytes = Buffer.from(body.data, "base64");
            const type = body.type.split(";")[0]!.trim().toLowerCase();
            if (bytes.length === 0) throw new NexoHttpError(400, "EMPTY_FILE", "The file is empty.");
            if (bytes.length > MAX_BYTES) throw new NexoHttpError(413, "FILE_TOO_LARGE", "The file is too large.");
            if (!ACCEPTED.test(type)) throw new NexoHttpError(415, "UNSUPPORTED_FILE_TYPE", `Files of type ${type} are not accepted.`);
            const id = randomUUID();
            const file: StoredFile = {
              id,
              name: basename(body.name.replace(/\\/g, "/")).replace(/[\u0000-\u001f"]/g, "") || "file",
              type,
              size: bytes.length,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              url: `/api/files/${id}`,
              createdAt: new Date().toISOString()
            };
            await mkdir(directory, { recursive: true });
            await writeFile(join(directory, id), bytes);
            await store.put("files", id, file);
            return httpResponse(201, file, { location: file.url });
          }
        },
        {
          name: "downloadFile",
          method: "GET",
          path: "/api/files/:id",
          handler: async (context) => {
            const id = context.params.id!;
            const file = /^[\w-]+$/.test(id) ? await store.get<StoredFile>("files", id) : undefined;
            if (file === undefined) throw new NexoHttpError(404, "NOT_FOUND", `File "${id}" not found.`);
            const bytes = await readFile(join(directory, id));
            const disposition = SHOW_INLINE.test(file.type) ? "inline" : "attachment";
            return httpResponse(200, bytes, {
              "content-type": file.type,
              "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
              "x-content-type-options": "nosniff",
              "content-security-policy": "default-src 'none'; sandbox"
            });
          }
        }
      ]
    }
  ];
}
