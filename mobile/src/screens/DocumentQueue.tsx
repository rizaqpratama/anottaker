import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import type { DatasetDocument, Project } from '@nertator/shared'
import { theme } from '../theme'

export function DocumentQueue({
  project,
  busy,
  onOpenDoc,
  onPage,
  onImport,
  onExport,
  onOpenLabels,
  onOpenSettings,
}: {
  project: Project
  busy: boolean
  onOpenDoc: (doc: DatasetDocument) => void
  onPage: (page: number) => void
  onImport: () => void
  onExport: () => void
  onOpenLabels: () => void
  onOpenSettings: () => void
}) {
  const totalPages = Math.max(1, Math.ceil(project.totalDocuments / project.pageSize))

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{project.name}</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={onOpenLabels}>
            <Text style={styles.headerAction}>Labels</Text>
          </Pressable>
          <Pressable onPress={onOpenSettings}>
            <Text style={styles.headerAction}>AI settings</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.subtitle}>
        {project.totalDocuments} {project.totalDocuments === 1 ? 'document' : 'documents'} · {project.labels.length} {project.labels.length === 1 ? 'label' : 'labels'}
      </Text>

      <View style={styles.actionRow}>
        <Pressable style={styles.actionButton} onPress={onImport} disabled={busy}>
          {busy ? <ActivityIndicator color={theme.text} /> : <Text style={styles.actionButtonText}>Import documents</Text>}
        </Pressable>
        <Pressable style={[styles.actionButton, styles.actionButtonSecondary]} onPress={onExport} disabled={busy || project.totalDocuments === 0}>
          <Text style={styles.actionButtonText}>Export JSONL</Text>
        </Pressable>
      </View>

      <FlatList
        data={project.documents}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onOpenDoc(item)}>
            <View style={[styles.statusDot, item.status === 'reviewed' && styles.statusDotReviewed]} />
            <Text style={styles.rowText} numberOfLines={2}>
              {item.text}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No documents yet. Import a .txt, .csv, or .jsonl file to get started.</Text>}
      />

      {totalPages > 1 ? (
        <View style={styles.pager}>
          <Pressable disabled={project.page === 0} onPress={() => onPage(project.page - 1)}>
            <Text style={[styles.pagerButton, project.page === 0 && styles.pagerButtonDisabled]}>Previous</Text>
          </Pressable>
          <Text style={styles.pagerLabel}>
            Page {project.page + 1} of {totalPages}
          </Text>
          <Pressable disabled={project.page >= totalPages - 1} onPress={() => onPage(project.page + 1)}>
            <Text style={[styles.pagerButton, project.page >= totalPages - 1 && styles.pagerButtonDisabled]}>Next</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, paddingTop: 60, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: theme.text, fontSize: 22, fontWeight: '700', flexShrink: 1 },
  headerActions: { flexDirection: 'row', gap: 16 },
  headerAction: { color: theme.accent, fontSize: 14, fontWeight: '600' },
  subtitle: { color: theme.textMuted, fontSize: 13, marginTop: 4 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  actionButton: { flex: 1, backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  actionButtonSecondary: { backgroundColor: theme.surfaceAlt },
  actionButtonText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  list: { paddingVertical: 16 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.textMuted, marginTop: 6 },
  statusDotReviewed: { backgroundColor: theme.accent },
  rowText: { color: theme.text, fontSize: 15, flex: 1 },
  empty: { color: theme.textMuted, textAlign: 'center', marginTop: 40 },
  pager: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderTopWidth: 1, borderTopColor: theme.border },
  pagerButton: { color: theme.accent, fontWeight: '600' },
  pagerButtonDisabled: { color: theme.textMuted },
  pagerLabel: { color: theme.textMuted, fontSize: 13 },
})
