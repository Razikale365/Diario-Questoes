export interface QuestionSourceDocumentRecord {
  id: string;
  fileName: string;
  mimeType: string;
  pageCount: number;
  importedAt: string;
  data: ArrayBuffer;
}

export interface QuestionSourceDocumentStore {
  get(id: string): Promise<QuestionSourceDocumentRecord | undefined>;
  put(record: QuestionSourceDocumentRecord): Promise<void>;
}

interface SaveQuestionSourceDocumentOptions {
  store?: QuestionSourceDocumentStore;
  now?: () => string;
}

const DATABASE_NAME = 'diario-questoes-source-documents';
const DATABASE_VERSION = 1;
const STORE_NAME = 'documents';

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao acessar o documento local.'));
  });

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao abrir os documentos locais.'));
  });

const browserStore: QuestionSourceDocumentStore = {
  async get(id) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      return await requestResult<QuestionSourceDocumentRecord | undefined>(
        transaction.objectStore(STORE_NAME).get(id),
      );
    } finally {
      database.close();
    }
  },
  async put(record) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      await requestResult(transaction.objectStore(STORE_NAME).put(record));
    } finally {
      database.close();
    }
  },
};

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export const buildQuestionSourceDocumentId = async (data: ArrayBuffer) => {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return `pdf_${bytesToHex(new Uint8Array(digest))}`;
};

export const loadQuestionSourceDocument = (
  id: string,
  store: QuestionSourceDocumentStore = browserStore,
) => store.get(id);

export const saveQuestionSourceDocument = async (
  file: File,
  pageCount: number,
  options: SaveQuestionSourceDocumentOptions = {},
) => {
  const store = options.store || browserStore;
  const data = await file.arrayBuffer();
  const id = await buildQuestionSourceDocumentId(data);
  const existing = await store.get(id);
  if (existing) return existing;

  const record: QuestionSourceDocumentRecord = {
    id,
    fileName: file.name,
    mimeType: file.type || 'application/pdf',
    pageCount,
    importedAt: (options.now || (() => new Date().toISOString()))(),
    data,
  };
  await store.put(record);
  return record;
};
