/**
 * IndexedDB for the static app: parsed chats keyed by slug, reports keyed by id.
 * No libraries, no schema beyond the two object stores.
 */
import type { ParsedChat, Report } from '../shared/types.js';

const DB_NAME = 'chatroast';
const DB_VERSION = 1;
const CHATS = 'chats';
const REPORTS = 'reports';

export interface ReportSummary {
  id: string;
  title: string;
  groupName: string;
  createdAt: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHATS)) db.createObjectStore(CHATS, { keyPath: 'slug' });
      if (!db.objectStoreNames.contains(REPORTS)) db.createObjectStore(REPORTS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('This browser would not open its database.'));
    req.onblocked = () =>
      reject(new Error('Another chatroast tab is holding the database open. Close it and reload.'));
  });
  // A failed open should not poison every later call.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

async function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('The database rejected that request.'));
    tx.onabort = () => reject(tx.error ?? new Error('The database transaction was aborted.'));
  });
}

export async function saveChat(chat: ParsedChat): Promise<void> {
  await run(CHATS, 'readwrite', (s) => s.put(chat));
}

export function getChat(slug: string): Promise<ParsedChat | undefined> {
  return run(CHATS, 'readonly', (s) => s.get(slug) as IDBRequest<ParsedChat | undefined>);
}

export async function saveReport(report: Report): Promise<void> {
  await run(REPORTS, 'readwrite', (s) => s.put(report));
}

export function getReport(id: string): Promise<Report | undefined> {
  return run(REPORTS, 'readonly', (s) => s.get(id) as IDBRequest<Report | undefined>);
}

/** Newest first. */
export async function listReports(): Promise<ReportSummary[]> {
  const all = await run(REPORTS, 'readonly', (s) => s.getAll() as IDBRequest<Report[]>);
  return all
    .map((r) => ({ id: r.id, title: r.title, groupName: r.groupName, createdAt: r.createdAt }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export async function deleteReport(id: string): Promise<void> {
  await run(REPORTS, 'readwrite', (s) => s.delete(id));
}
