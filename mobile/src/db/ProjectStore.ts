import * as SQLite from 'expo-sqlite'
import { PROJECT_SCHEMA_SQL, uid } from '@nertator/shared'
import type { DatasetDocument, DocumentStatus, EntitySpan, Label, Project } from '@nertator/shared'

const DATABASE_NAME = 'nertator.db'

type ProjectRow = { id: string; name: string }
type LabelRow = { id: string; name: string; color: string; description: string | null }
type DocumentRow = { id: string; text: string; source: string; status: string; created_at: string }
type EntityRow = { id: string; document_id: string; start: number; end: number; label_id: string }
type CountRow = { total: number }

// expo-sqlite is the mobile equivalent of desktop's better-sqlite3 binding in
// electron/database.cjs. Table shapes come from @nertator/shared's documented
// schema contract (shared/src/db/schema.ts) so both platforms stay consistent,
// but each implements its own data-access layer since the SQLite APIs differ.
export class ProjectStore {
  private constructor(private db: SQLite.SQLiteDatabase) {}

  static async open(): Promise<ProjectStore> {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME)
    await db.execAsync(PROJECT_SCHEMA_SQL)
    return new ProjectStore(db)
  }

  async initialize(name: string) {
    const existing = await this.db.getFirstAsync<ProjectRow>('SELECT id FROM project LIMIT 1')
    if (!existing) await this.db.runAsync('INSERT INTO project (id, name) VALUES (?, ?)', uid(), name)
  }

  // Mobile has one app-sandboxed project (see plan assumption #3), so "starting a
  // new project" clears the existing one rather than opening a different file.
  async reset(name: string) {
    await this.db.execAsync('DELETE FROM entities; DELETE FROM documents; DELETE FROM labels; DELETE FROM project;')
    await this.initialize(name)
  }

  async snapshot(page = 0, pageSize = 100): Promise<Project> {
    const project = await this.db.getFirstAsync<ProjectRow>('SELECT * FROM project LIMIT 1')
    const labelRows = await this.db.getAllAsync<LabelRow>('SELECT * FROM labels ORDER BY name')
    const labels: Label[] = labelRows.map((row) => ({ id: row.id, name: row.name, color: row.color, description: row.description || undefined }))
    const offset = page * pageSize
    const documentRows = await this.db.getAllAsync<DocumentRow>('SELECT * FROM documents ORDER BY created_at, id LIMIT ? OFFSET ?', pageSize, offset)
    const documents: DatasetDocument[] = documentRows.map((row) => ({ id: row.id, text: row.text, source: row.source, status: row.status as DocumentStatus, createdAt: row.created_at, entities: [] }))
    const countRow = await this.db.getFirstAsync<CountRow>('SELECT COUNT(*) AS total FROM documents')
    return { id: project?.id ?? '', name: project?.name ?? '', path: DATABASE_NAME, labels, documents, totalDocuments: countRow?.total ?? 0, page, pageSize }
  }

  async getDocument(id: string): Promise<DatasetDocument | null> {
    const row = await this.db.getFirstAsync<DocumentRow>('SELECT * FROM documents WHERE id = ?', id)
    if (!row) return null
    const entityRows = await this.db.getAllAsync<EntityRow>('SELECT * FROM entities WHERE document_id = ? ORDER BY start', id)
    const entities: EntitySpan[] = entityRows.map((entity) => ({ id: entity.id, documentId: entity.document_id, start: entity.start, end: entity.end, labelId: entity.label_id }))
    return { id: row.id, text: row.text, source: row.source, status: row.status as DocumentStatus, createdAt: row.created_at, entities }
  }

  async addLabel(label: Label) {
    await this.db.runAsync('INSERT INTO labels (id, name, color, description) VALUES (?, ?, ?, ?)', label.id, label.name, label.color, label.description || '')
  }

  async updateLabel(label: Label) {
    if (!label.name.trim()) throw new Error('A label name is required.')
    await this.db.runAsync('UPDATE labels SET name = ?, color = ?, description = ? WHERE id = ?', label.name.trim(), label.color, label.description || '', label.id)
  }

  async removeLabel(id: string) {
    const usage = await this.db.getFirstAsync<CountRow>('SELECT COUNT(*) AS total FROM entities WHERE label_id = ?', id)
    if (usage && usage.total) throw new Error(`This label is applied to ${usage.total} ${usage.total === 1 ? 'entity' : 'entities'}. Remove those annotations before deleting it.`)
    await this.db.runAsync('DELETE FROM labels WHERE id = ?', id)
  }

  async addDocuments(texts: string[]) {
    const now = new Date().toISOString()
    await this.db.withTransactionAsync(async () => {
      for (const text of texts) await this.db.runAsync('INSERT INTO documents (id, text, source, status, created_at) VALUES (?, ?, ?, ?, ?)', uid(), text, 'import', 'draft', now)
    })
  }

  async addEntity(entity: EntitySpan) {
    await this.db.runAsync('INSERT INTO entities (id, document_id, start, end, label_id) VALUES (?, ?, ?, ?, ?)', entity.id, entity.documentId, entity.start, entity.end, entity.labelId)
  }

  async removeEntity(id: string) {
    await this.db.runAsync('DELETE FROM entities WHERE id = ?', id)
  }

  async clearEntities(documentId: string) {
    await this.db.runAsync('DELETE FROM entities WHERE document_id = ?', documentId)
  }

  async deleteDocument(id: string) {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('DELETE FROM entities WHERE document_id = ?', id)
      await this.db.runAsync('DELETE FROM documents WHERE id = ?', id)
    })
  }

  async setStatus(id: string, status: DocumentStatus) {
    await this.db.runAsync('UPDATE documents SET status = ? WHERE id = ?', status, id)
  }

  // Mobile's single-project dataset is expected to be small enough to hold in
  // memory for export (unlike desktop's paginated snapshot(), which deliberately
  // never loads a whole project at once for large-dataset scalability).
  async getAllDocumentsWithEntities(reviewedOnly: boolean): Promise<DatasetDocument[]> {
    const documentRows = await this.db.getAllAsync<DocumentRow>(
      reviewedOnly ? "SELECT * FROM documents WHERE status = 'reviewed' ORDER BY created_at, id" : 'SELECT * FROM documents ORDER BY created_at, id',
    )
    const entityRows = await this.db.getAllAsync<EntityRow>('SELECT * FROM entities ORDER BY document_id, start')
    const entitiesByDocument = new Map<string, EntitySpan[]>()
    for (const row of entityRows) {
      const entity: EntitySpan = { id: row.id, documentId: row.document_id, start: row.start, end: row.end, labelId: row.label_id }
      const list = entitiesByDocument.get(row.document_id) ?? []
      list.push(entity)
      entitiesByDocument.set(row.document_id, list)
    }
    return documentRows.map((row) => ({ id: row.id, text: row.text, source: row.source, status: row.status as DocumentStatus, createdAt: row.created_at, entities: entitiesByDocument.get(row.id) ?? [] }))
  }
}
