const Database = require('better-sqlite3')
const { randomUUID } = require('node:crypto')

class ProjectDatabase {
  constructor(filePath) {
    this.path = filePath
    this.db = new Database(filePath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS labels (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, description TEXT DEFAULT '');
      CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, text TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, label_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at, id);
      CREATE INDEX IF NOT EXISTS idx_entities_document_id ON entities(document_id);`)
  }
  initialize(name) { if (!this.db.prepare('SELECT id FROM project LIMIT 1').get()) this.db.prepare('INSERT INTO project VALUES (?, ?)').run(randomUUID(), name) }
  snapshot(page = 0, pageSize = 100, searchQuery = '') {
    const project = this.db.prepare('SELECT * FROM project LIMIT 1').get()
    const labels = this.db.prepare('SELECT * FROM labels ORDER BY name').all().map((x) => ({ ...x, description: x.description || undefined }))
    const offset = page * pageSize
    const query = String(searchQuery || '').trim().slice(0, 500)
    const where = query ? "WHERE text COLLATE NOCASE LIKE ? ESCAPE '\\'" : ''
    const parameters = query ? [`%${query.replace(/[\\%_]/g, '\\$&')}%`] : []
    const rows = this.db.prepare(`SELECT * FROM documents ${where} ORDER BY created_at, id LIMIT ? OFFSET ?`).all(...parameters, pageSize, offset)
    const documents = rows.map((x) => ({ id: x.id, text: x.text, source: x.source, status: x.status, createdAt: x.created_at, entities: [] }))
    const count = this.db.prepare(`SELECT COUNT(*) AS total FROM documents ${where}`).get(...parameters).total
    return { id: project.id, name: project.name, path: this.path, labels, documents, totalDocuments: count, page, pageSize, searchQuery: query }
  }
  getDocument(id) { const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id); if (!row) return null; const entities = this.db.prepare('SELECT * FROM entities WHERE document_id = ? ORDER BY start').all(id).map((x) => ({ id: x.id, documentId: x.document_id, start: x.start, end: x.end, labelId: x.label_id })); return { id: row.id, text: row.text, source: row.source, status: row.status, createdAt: row.created_at, entities } }
  exportJsonl(filePath, reviewedOnly) { const labels = new Map(this.db.prepare('SELECT id, name FROM labels').all().map((x) => [x.id, x.name])); const rows = this.db.prepare(`SELECT id, text FROM documents ${reviewedOnly ? "WHERE status = 'reviewed'" : ''} ORDER BY created_at, id`).iterate(); const findEntities = this.db.prepare('SELECT start, end, label_id FROM entities WHERE document_id = ? ORDER BY start'); const fd = require('node:fs').openSync(filePath, 'w'); let count = 0; try { for (const row of rows) { const entities = findEntities.all(row.id).map((entity) => ({ start: entity.start, end: entity.end, label: labels.get(entity.label_id) || 'UNKNOWN' })); require('node:fs').writeSync(fd, `${JSON.stringify({ text: row.text, entities })}\n`); count++ } } finally { require('node:fs').closeSync(fd) } return count }
  addLabel(label) { this.db.prepare('INSERT INTO labels VALUES (?, ?, ?, ?)').run(label.id, label.name, label.color, label.description || '') }
  updateLabel(label) { if (!label.name?.trim()) throw new Error('A label name is required.'); this.db.prepare('UPDATE labels SET name = ?, color = ?, description = ? WHERE id = ?').run(label.name.trim(), label.color, label.description || '', label.id) }
  removeLabel(id) { const usage = this.db.prepare('SELECT COUNT(*) AS total FROM entities WHERE label_id = ?').get(id).total; if (usage) throw new Error(`This label is applied to ${usage} ${usage === 1 ? 'entity' : 'entities'}. Remove those annotations before deleting it.`); this.db.prepare('DELETE FROM labels WHERE id = ?').run(id) }
  addDocuments(items) { const insert = this.db.prepare('INSERT INTO documents VALUES (?, ?, ?, ?, ?)'); const now = new Date().toISOString(); const tx = this.db.transaction(() => items.forEach((text) => insert.run(randomUUID(), text, 'import', 'draft', now))); tx() }
  addEntity(entity) { this.db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?)').run(entity.id, entity.documentId, entity.start, entity.end, entity.labelId) }
  updateEntityLabel(id, labelId) { this.db.prepare('UPDATE entities SET label_id = ? WHERE id = ?').run(labelId, id) }
  removeEntity(id) { this.db.prepare('DELETE FROM entities WHERE id = ?').run(id) }
  clearEntities(documentId) { this.db.prepare('DELETE FROM entities WHERE document_id = ?').run(documentId) }
  deleteDocument(id) { const tx = this.db.transaction(() => { this.db.prepare('DELETE FROM entities WHERE document_id = ?').run(id); this.db.prepare('DELETE FROM documents WHERE id = ?').run(id) }); tx() }
  setStatus(id, status) { this.db.prepare('UPDATE documents SET status = ? WHERE id = ?').run(status, id) }
  close() { this.db.close() }
}
module.exports = { ProjectDatabase }
