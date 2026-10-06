import { createDiskBlobStore, createFiles, type NexoDocumentStore, type NexoModule } from "@nexo-alpha/core";

export function modules(store: NexoDocumentStore, directory: string): NexoModule[] {
  return [
    createFiles({
      store,
      blobs: createDiskBlobStore(directory),
      maxBytes: 1024 * 1024,
      accept: ["image/*", "application/pdf", "text/plain"]
    })
  ];
}
