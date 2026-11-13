/**
 * Wallpaper media lives in IndexedDB (blobs, not counted against chrome.storage
 * quota). Changes are announced via a tiny chrome.storage key so other open new
 * tabs reload the media.
 */
const DB = 'oxygen-wallpapers';
const STORE = 'media';
export type MediaSlot = 'image' | 'video';
export const MEDIA_STAMP_KEY = 'oxygen.wallpaper.stamp';
export const MAX_MEDIA_BYTES = 200 * 1024 * 1024;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function putMedia(slot: MediaSlot, file: Blob): Promise<void> {
  if (file.size > MAX_MEDIA_BYTES) throw new Error('File too large (max 200 MB)');
  await tx('readwrite', (s) => s.put(file, slot));
  await chrome.storage?.local.set({ [MEDIA_STAMP_KEY]: { [slot]: Date.now(), size: file.size } });
}

export async function getMedia(slot: MediaSlot): Promise<Blob | null> {
  return ((await tx('readonly', (s) => s.get(slot))) as Blob | undefined) ?? null;
}

export async function deleteMedia(slot: MediaSlot): Promise<void> {
  await tx('readwrite', (s) => s.delete(slot));
  await chrome.storage?.local.set({ [MEDIA_STAMP_KEY]: { [slot]: Date.now(), size: 0 } });
}
