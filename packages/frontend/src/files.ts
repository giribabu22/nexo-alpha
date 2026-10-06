/**
 * Uploads to a server `createFiles()` module. Reached as `client.files`.
 *
 * ```ts
 * const file = await client.files.upload(input.files[0]);   // a File from <input type="file">
 * await client.resource(Profile).update(id, { photo: file.id });
 * <img src={client.files.url(profile.photo)} />
 * ```
 */

import { FILES_PATH, type NexoFile } from "@nexo-alpha/core/model";
import type { NexoClient } from "./client.js";

export class NexoFilesClient {
  private readonly client: NexoClient;
  readonly path: string;

  constructor(client: NexoClient, path = FILES_PATH) {
    this.client = client;
    this.path = path.replace(/\/+$/, "");
  }

  /**
   * Uploads a Blob or File (its own name and type are used unless given).
   * Rejects with NexoApiError 413 when too large, 415 when the type is not accepted.
   */
  readonly upload = (file: Blob, options: { readonly name?: string; readonly type?: string } = {}): Promise<NexoFile> => {
    const name = options.name ?? (file as Blob & { name?: string }).name ?? "file";
    const type = options.type ?? (file.type !== "" ? file.type : "application/octet-stream");
    return this.client.api<NexoFile>(`${this.path}?name=${encodeURIComponent(name)}`, {
      method: "POST",
      body: file,
      headers: { "Content-Type": type }
    });
  };

  /** Absolute download URL, for links and `<img src>`. Works without credentials unless the server sets `auth.read`. */
  readonly url = (id: string): string => `${this.client.baseUrl}${this.path}/${encodeURIComponent(id)}`;

  readonly info = (id: string): Promise<NexoFile> => this.client.get(`${this.path}/${encodeURIComponent(id)}/info`);

  /** The content, fetched with the client's credentials (for files behind `auth.read`). */
  readonly download = (id: string): Promise<Blob> =>
    this.client.request(`${this.path}/${encodeURIComponent(id)}`, { method: "GET" }, (response) => response.blob());

  readonly delete = (id: string): Promise<void> => this.client.delete(`${this.path}/${encodeURIComponent(id)}`);
}
