/**
 * Which record owns an uploaded file. `resource()` attaches the files a
 * record references and detaches them when the record lets go (the field
 * changes or the record is deleted); `createFiles` removes detached files
 * after a delay. A file belongs to one record at a time.
 *
 * Owners are strings like "profiles/6f1c…" (collection/record id). Changes
 * use compare-and-swap, so two records cannot both claim one file.
 */

import { NexoHttpError } from "./errors.js";
import type { NexoFile } from "./files-contract.js";
import type { NexoDocumentStore } from "./storage.js";

export const FILES_COLLECTION = "files";

/** Marks `fileId` as owned by `owner`. Throws 409 if another owner holds it, 404 if there is no such file. */
export async function attachFile(store: NexoDocumentStore, fileId: string, owner: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const file = await store.get<NexoFile & { removing?: boolean }>(FILES_COLLECTION, fileId);
    // A file cleanup has started removing is as good as gone.
    if (file === undefined || file.removing === true) throw new NexoHttpError(404, "NOT_FOUND", `File "${fileId}" not found.`);
    if (file.attachedTo === owner) return;
    if (file.attachedTo !== undefined) {
      throw new NexoHttpError(409, "FILE_IN_USE", `File "${fileId}" already belongs to ${file.attachedTo}.`);
    }
    const { detachedAt: _released, ...rest } = file;
    if (await store.replaceIf(FILES_COLLECTION, fileId, file, { ...rest, attachedTo: owner })) return;
  }
  throw new NexoHttpError(409, "CONFLICT", `File "${fileId}" kept changing; try again.`);
}

/** Releases `fileId` if `owner` holds it (any owner when omitted), so cleanup may remove it. Missing files are ignored. */
export async function detachFile(store: NexoDocumentStore, fileId: string, owner?: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const file = await store.get<NexoFile>(FILES_COLLECTION, fileId);
    if (file === undefined || file.attachedTo === undefined) return;
    if (owner !== undefined && file.attachedTo !== owner) return;
    const { attachedTo: _owner, ...rest } = file;
    if (await store.replaceIf(FILES_COLLECTION, fileId, file, { ...rest, detachedAt: new Date().toISOString() })) return;
  }
}
