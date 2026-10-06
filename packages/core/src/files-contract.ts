/**
 * The file-upload contract shared by the server (`createFiles`) and the
 * browser client. Browser-safe: no Node.js imports.
 *
 * | Call                | HTTP                                              | Success |
 * |---------------------|---------------------------------------------------|---------|
 * | upload              | `POST /api/files?name=<file name>`, raw body, `Content-Type` = file type | 201 {@link NexoFile} |
 * | download / `<img>`  | `GET /api/files/:id`                              | 200 bytes |
 * | info                | `GET /api/files/:id/info`                         | 200 {@link NexoFile} |
 * | delete              | `DELETE /api/files/:id`                           | 204 |
 */

/** Default API path of the files module. */
export const FILES_PATH = "/api/files";

/** Metadata of an uploaded file. A model's `field.file()` stores its `id`. */
export interface NexoFile {
  readonly id: string;
  /** The uploaded file's name, cleaned (no directories or control characters). */
  readonly name: string;
  /** MIME type, as declared by the uploader. */
  readonly type: string;
  /** Bytes. */
  readonly size: number;
  /** Hex SHA-256 of the content. */
  readonly sha256: string;
  /** Where to download it, relative to the API's base URL. */
  readonly url: string;
  /** Who uploaded it (the authenticated user's `sub`), when known. */
  readonly uploadedBy?: string;
  readonly createdAt: string;
}

/**
 * Whether MIME `type` matches any of `patterns` ("image/png", "image/*", "*\/*").
 * Parameters such as "; charset=utf-8" are ignored; matching is case-insensitive.
 */
export function mimeMatches(type: string, patterns: readonly string[]): boolean {
  const [main, sub] = type.split(";")[0]!.trim().toLowerCase().split("/");
  return patterns.some((pattern) => {
    const [pMain, pSub] = pattern.trim().toLowerCase().split("/");
    return (pMain === "*" || pMain === main) && (pSub === "*" || pSub === sub);
  });
}
