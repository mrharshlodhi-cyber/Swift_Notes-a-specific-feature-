export type StoredNoteImage = {
  id: string;
  noteId: string;
  blob: Blob;
  type: string;
  createdAt: number;
  name?: string;
};

const DATABASE_NAME = "swiftnotes";
const STORE_NAME = "note-images";

let databasePromise: Promise<IDBDatabase> | null = null;

function getDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, {
            keyPath: "id",
          });
          store.createIndex("noteId", "noteId", { unique: false });
        }
      };

      request.onsuccess = () => {
        const database = request.result;

        // Let a future upgrade in another tab proceed.
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };

        resolve(database);
      };

      request.onerror = () => {
        databasePromise = null; // allow a retry
        reject(request.error);
      };
    });
  }

  return databasePromise;
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, setResult: (value: T) => void) => void,
): Promise<T> {
  const database = await getDatabase();

  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    let result: T | undefined;

    work(transaction.objectStore(STORE_NAME), (value) => {
      result = value;
    });

    transaction.oncomplete = () => resolve(result as T);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new DOMException("Transaction aborted", "AbortError"),
      );
  });
}

export function getImagesForNote(noteId: string): Promise<StoredNoteImage[]> {
  return runTransaction<StoredNoteImage[]>("readonly", (store, setResult) => {
    const request = store.index("noteId").getAll(noteId);

    request.onsuccess = () => {
      const images = request.result as StoredNoteImage[];
      setResult(images.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)));
    };
  });
}

// Makes the stored images for a note exactly match `images`, atomically.
export function replaceImagesForNote(
  noteId: string,
  images: StoredNoteImage[],
): Promise<void> {
  return runTransaction<void>("readwrite", (store) => {
    const keysRequest = store.index("noteId").getAllKeys(noteId);

    keysRequest.onsuccess = () => {
      const keep = new Set(images.map((image) => image.id));

      keysRequest.result.forEach((key) => {
        if (!keep.has(key as string)) store.delete(key);
      });

      images.forEach((image) => store.put(image));
    };
  });
}

export function deleteImagesForNote(noteId: string): Promise<void> {
  return replaceImagesForNote(noteId, []);
}
