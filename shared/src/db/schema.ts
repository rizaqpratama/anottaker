// Documentation-as-code, not a runtime dependency. Desktop (better-sqlite3) and
// mobile (expo-sqlite) use entirely different SQLite bindings and each implements
// its own data-access layer — this file exists so both implementations stay
// consistent with the same table shapes and access contract, not to be imported
// for actual queries.

export const PROJECT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS labels (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, description TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, text TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, label_id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at, id);
CREATE INDEX IF NOT EXISTS idx_entities_document_id ON entities(document_id);
`.trim()

// The contract every platform's data-access layer should honor. Documents pages
// must stay small (see snapshot) — never load an entire project's documents into
// memory at once; that's a deliberate scalability constraint, not an oversight.
export interface ProjectDataStore {
  initialize(name: string): void
  snapshot(page?: number, pageSize?: number): {
    id: string
    name: string
    labels: { id: string; name: string; color: string; description?: string }[]
    documents: { id: string; text: string; source: string; status: string; createdAt: string }[]
    totalDocuments: number
    page: number
    pageSize: number
  }
  getDocument(id: string): { id: string; text: string; source: string; status: string; createdAt: string; entities: { id: string; documentId: string; start: number; end: number; labelId: string }[] } | null
  addLabel(label: { id: string; name: string; color: string; description?: string }): void
  updateLabel(label: { id: string; name: string; color: string; description?: string }): void
  removeLabel(id: string): void
  addDocuments(texts: string[]): void
  addEntity(entity: { id: string; documentId: string; start: number; end: number; labelId: string }): void
  removeEntity(id: string): void
  clearEntities(documentId: string): void
  deleteDocument(id: string): void
  setStatus(id: string, status: string): void
}
