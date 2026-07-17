export type DocumentStatus = 'draft' | 'reviewed'
export type Label = { id: string; name: string; color: string; description?: string }
export type EntitySpan = { id: string; documentId: string; start: number; end: number; labelId: string }
export type DatasetDocument = { id: string; text: string; source: string; status: DocumentStatus; createdAt: string; entities: EntitySpan[] }
export type Project = { id: string; name: string; path: string; labels: Label[]; documents: DatasetDocument[]; totalDocuments: number; page: number; pageSize: number }
export type AiSuggestion = { id: string; start: number; end: number; label: string; confidence: number }
