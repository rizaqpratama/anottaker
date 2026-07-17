import { useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { validateSpan } from '@nertator/shared'
import type { AiSuggestion, DatasetDocument, DocumentStatus, EntitySpan, Label } from '@nertator/shared'
import { theme } from '../theme'

type PendingSelection = { start: number; end: number; text: string }

// RN's TextInput can't render styled nested spans, so annotation uses two modes on
// the same document text: a read-only "view" pass with tappable <Text> marks for
// existing entities, and a plain selectable "select" pass (TextInput.onSelectionChange
// gives native character offsets) for picking a new span to label.
export function Annotator({
  doc,
  labels,
  suggestions,
  aiBusy,
  onBack,
  onAddEntity,
  onRemoveEntity,
  onClearEntities,
  onDeleteDocument,
  onSetStatus,
  onSuggest,
  onAcceptSuggestion,
  onAcceptAllSuggestions,
}: {
  doc: DatasetDocument
  labels: Label[]
  suggestions: AiSuggestion[]
  aiBusy: boolean
  onBack: () => void
  onAddEntity: (start: number, end: number, labelId: string) => Promise<void>
  onRemoveEntity: (id: string) => Promise<void>
  onClearEntities: () => Promise<void>
  onDeleteDocument: () => Promise<void>
  onSetStatus: (status: DocumentStatus) => Promise<void>
  onSuggest: () => Promise<void>
  onAcceptSuggestion: (suggestion: AiSuggestion) => Promise<void>
  onAcceptAllSuggestions: () => Promise<void>
}) {
  const [mode, setMode] = useState<'view' | 'select'>('view')
  const [pending, setPending] = useState<PendingSelection | null>(null)
  const [error, setError] = useState('')

  const sortedEntities = [...doc.entities].sort((a, b) => a.start - b.start)

  const confirmSpan = async (labelId: string) => {
    if (!pending) return
    const message = validateSpan(doc.text, pending, doc.entities)
    if (message) {
      setError(message)
      return
    }
    try {
      await onAddEntity(pending.start, pending.end, labelId)
      setPending(null)
      setMode('view')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add entity.')
    }
  }

  const cancelSelection = () => {
    setMode('view')
    setPending(null)
    setError('')
  }

  const confirmClear = () => {
    Alert.alert('Clear annotations', 'Remove all annotations from this document?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => onClearEntities() },
    ])
  }

  const confirmDelete = () => {
    Alert.alert('Delete record', 'Delete this document and its annotations?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDeleteDocument() },
    ])
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack}>
          <Text style={styles.back}>‹ Queue</Text>
        </Pressable>
        <Pressable onPress={() => onSetStatus(doc.status === 'reviewed' ? 'draft' : 'reviewed')}>
          <Text style={[styles.statusToggle, doc.status === 'reviewed' && styles.statusToggleActive]}>
            {doc.status === 'reviewed' ? 'Reviewed' : 'Mark reviewed'}
          </Text>
        </Pressable>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {mode === 'view' ? (
          <Text style={styles.text}>{renderSegments(doc.text, sortedEntities, labels, onRemoveEntity)}</Text>
        ) : (
          <TextInput
            style={styles.selectInput}
            multiline
            editable={false}
            value={doc.text}
            onSelectionChange={(event) => {
              const { start, end } = event.nativeEvent.selection
              if (start === end) return
              setPending({ start, end, text: doc.text.slice(start, end) })
            }}
          />
        )}
      </ScrollView>

      {mode === 'select' ? (
        <View style={styles.selectionBar}>
          {pending ? (
            <>
              <Text style={styles.selectionPreview} numberOfLines={1}>
                &ldquo;{pending.text}&rdquo;
              </Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.labelChips}>
                {labels.map((label) => (
                  <Pressable key={label.id} style={[styles.labelChip, { backgroundColor: label.color }]} onPress={() => confirmSpan(label.id)}>
                    <Text style={styles.labelChipText}>{label.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <Text style={styles.selectionHint}>Select text above to annotate it.</Text>
          )}
          <Pressable style={styles.cancelSelect} onPress={cancelSelection}>
            <Text style={styles.cancelSelectText}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.toolbar}>
          <Pressable style={styles.toolbarButton} onPress={() => setMode('select')} disabled={labels.length === 0}>
            <Text style={styles.toolbarButtonText}>Annotate</Text>
          </Pressable>
          <Pressable style={styles.toolbarButton} onPress={() => Clipboard.setStringAsync(doc.text)}>
            <Text style={styles.toolbarButtonText}>Copy</Text>
          </Pressable>
          <Pressable style={styles.toolbarButton} onPress={confirmClear} disabled={doc.entities.length === 0}>
            <Text style={styles.toolbarButtonText}>Clear</Text>
          </Pressable>
          <Pressable style={styles.toolbarButtonDanger} onPress={confirmDelete}>
            <Text style={styles.toolbarButtonText}>Delete</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.aiPanel}>
        <View style={styles.aiHeader}>
          <Text style={styles.aiTitle}>AI suggestions</Text>
          <Pressable onPress={onSuggest} disabled={aiBusy || labels.length === 0}>
            {aiBusy ? <ActivityIndicator color={theme.accent} /> : <Text style={styles.aiSuggestButton}>Suggest entities</Text>}
          </Pressable>
        </View>
        {suggestions.length > 0 ? (
          <>
            {suggestions.map((suggestion) => (
              <View key={suggestion.id} style={styles.suggestionRow}>
                <Text style={styles.suggestionText} numberOfLines={1}>
                  {doc.text.slice(suggestion.start, suggestion.end)} · {suggestion.label} · {Math.round(suggestion.confidence * 100)}%
                </Text>
                <Pressable onPress={() => onAcceptSuggestion(suggestion)}>
                  <Text style={styles.acceptButton}>Accept</Text>
                </Pressable>
              </View>
            ))}
            <Pressable style={styles.acceptAllButton} onPress={onAcceptAllSuggestions}>
              <Text style={styles.acceptAllButtonText}>Accept all</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.aiHint}>Suggestions are kept separate from your dataset until you accept them.</Text>
        )}
      </View>
    </View>
  )
}

function renderSegments(text: string, entities: EntitySpan[], labels: Label[], onRemove: (id: string) => void): ReactNode[] {
  const labelById = new Map(labels.map((label) => [label.id, label]))
  const nodes: ReactNode[] = []
  let cursor = 0
  entities.forEach((entity, index) => {
    if (entity.start > cursor) nodes.push(<Text key={`t-${index}`}>{text.slice(cursor, entity.start)}</Text>)
    const label = labelById.get(entity.labelId)
    nodes.push(
      <Text key={entity.id} style={[styles.mark, { backgroundColor: label?.color || theme.surfaceAlt }]} onPress={() => onRemove(entity.id)}>
        {text.slice(entity.start, entity.end)}
        <Text style={styles.markLabel}> {label?.name || 'UNKNOWN'}</Text>
      </Text>,
    )
    cursor = entity.end
  })
  if (cursor < text.length) nodes.push(<Text key="t-end">{text.slice(cursor)}</Text>)
  return nodes
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, paddingTop: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  back: { color: theme.accent, fontSize: 16, fontWeight: '600' },
  statusToggle: { color: theme.textMuted, fontSize: 14, fontWeight: '600' },
  statusToggleActive: { color: theme.accent },
  body: { flex: 1, marginTop: 12 },
  bodyContent: { paddingHorizontal: 20, paddingBottom: 20 },
  text: { color: theme.text, fontSize: 16, lineHeight: 24 },
  selectInput: { color: theme.text, fontSize: 16, lineHeight: 24, minHeight: 200 },
  mark: { borderRadius: 4, paddingHorizontal: 2, color: '#0c0c0f' },
  markLabel: { fontSize: 10, fontWeight: '700', opacity: 0.75 },
  selectionBar: { borderTopWidth: 1, borderTopColor: theme.border, paddingHorizontal: 20, paddingVertical: 14, gap: 10 },
  selectionPreview: { color: theme.text, fontSize: 14, fontStyle: 'italic' },
  selectionHint: { color: theme.textMuted, fontSize: 13 },
  labelChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  labelChip: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  labelChipText: { color: '#0c0c0f', fontSize: 13, fontWeight: '600' },
  cancelSelect: { alignSelf: 'flex-start' },
  cancelSelectText: { color: theme.textMuted, fontSize: 13 },
  error: { color: theme.danger, fontSize: 13 },
  toolbar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.border, paddingHorizontal: 20, paddingVertical: 12, gap: 10 },
  toolbarButton: { flex: 1, backgroundColor: theme.surfaceAlt, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  toolbarButtonDanger: { flex: 1, backgroundColor: theme.surfaceAlt, borderRadius: 8, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: theme.danger },
  toolbarButtonText: { color: theme.text, fontSize: 13, fontWeight: '600' },
  aiPanel: { borderTopWidth: 1, borderTopColor: theme.border, paddingHorizontal: 20, paddingVertical: 14, maxHeight: 220 },
  aiHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  aiTitle: { color: theme.text, fontSize: 15, fontWeight: '700' },
  aiSuggestButton: { color: theme.accent, fontSize: 14, fontWeight: '600' },
  aiHint: { color: theme.textMuted, fontSize: 12, marginTop: 8 },
  suggestionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border },
  suggestionText: { color: theme.text, fontSize: 13, flex: 1, marginRight: 10 },
  acceptButton: { color: theme.accent, fontSize: 13, fontWeight: '600' },
  acceptAllButton: { marginTop: 10, alignSelf: 'flex-start' },
  acceptAllButtonText: { color: theme.accent, fontSize: 13, fontWeight: '700' },
})
