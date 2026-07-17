import { useState } from 'react'
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { uid } from '@nertator/shared'
import type { Label } from '@nertator/shared'
import { nextLabelColor, LABEL_COLORS } from '../palette'
import { theme } from '../theme'

export function LabelsModal({
  visible,
  labels,
  onClose,
  onAdd,
  onUpdate,
  onRemove,
}: {
  visible: boolean
  labels: Label[]
  onClose: () => void
  onAdd: (label: Label) => Promise<void>
  onUpdate: (label: Label) => Promise<void>
  onRemove: (id: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const startEditing = (label: Label) => {
    setEditingId(label.id)
    setName(label.name)
    setDescription(label.description || '')
  }

  const resetForm = () => {
    setEditingId(null)
    setName('')
    setDescription('')
  }

  const save = async () => {
    if (!name.trim()) return
    try {
      if (editingId) {
        const existing = labels.find((item) => item.id === editingId)
        if (existing) await onUpdate({ ...existing, name: name.trim(), description: description.trim() || undefined })
      } else {
        await onAdd({ id: uid(), name: name.trim(), color: nextLabelColor(labels.length), description: description.trim() || undefined })
      }
      resetForm()
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save label.')
    }
  }

  const setColor = async (label: Label, color: string) => {
    try {
      await onUpdate({ ...label, color })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update label.')
    }
  }

  const removeLabel = (label: Label) => {
    Alert.alert('Delete label', `Delete "${label.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await onRemove(label.id)
            if (editingId === label.id) resetForm()
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete label.')
          }
        },
      },
    ])
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Manage labels</Text>
          <Pressable onPress={onClose}>
            <Text style={styles.close}>Done</Text>
          </Pressable>
        </View>

        <FlatList
          data={labels}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable style={styles.swatchRow} onPress={() => startEditing(item)}>
                <View style={[styles.swatch, { backgroundColor: item.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.name}</Text>
                  {item.description ? <Text style={styles.rowSubtitle}>{item.description}</Text> : null}
                </View>
              </Pressable>
              <Pressable onPress={() => removeLabel(item)}>
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No labels yet. Add one below.</Text>}
        />

        <View style={styles.form}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {editingId ? (
            <View style={styles.colorRow}>
              {LABEL_COLORS.map((color) => (
                <Pressable
                  key={color}
                  style={[styles.colorSwatch, { backgroundColor: color }, color === labels.find((l) => l.id === editingId)?.color && styles.colorSwatchSelected]}
                  onPress={() => {
                    const label = labels.find((item) => item.id === editingId)
                    if (label) setColor(label, color)
                  }}
                />
              ))}
            </View>
          ) : null}
          <TextInput style={styles.input} placeholder="Label name" placeholderTextColor={theme.textMuted} value={name} onChangeText={setName} />
          <TextInput style={styles.input} placeholder="Description (optional)" placeholderTextColor={theme.textMuted} value={description} onChangeText={setDescription} />
          <View style={styles.formButtons}>
            {editingId ? (
              <Pressable style={styles.secondaryButton} onPress={resetForm}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
            ) : null}
            <Pressable style={[styles.addButton, !name.trim() && styles.addButtonDisabled]} disabled={!name.trim()} onPress={save}>
              <Text style={styles.addButtonText}>{editingId ? 'Save changes' : 'Add label'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, paddingTop: 60, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { color: theme.text, fontSize: 22, fontWeight: '700' },
  close: { color: theme.accent, fontSize: 16, fontWeight: '600' },
  list: { paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
  swatchRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  swatch: { width: 20, height: 20, borderRadius: 6 },
  rowTitle: { color: theme.text, fontSize: 16, fontWeight: '600' },
  rowSubtitle: { color: theme.textMuted, fontSize: 13, marginTop: 2 },
  remove: { color: theme.danger, fontSize: 14, fontWeight: '600' },
  empty: { color: theme.textMuted, textAlign: 'center', marginTop: 24 },
  form: { borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 16, paddingBottom: 24, gap: 10 },
  input: { backgroundColor: theme.surface, color: theme.text, borderRadius: 10, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  colorRow: { flexDirection: 'row', gap: 10 },
  colorSwatch: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: 'transparent' },
  colorSwatchSelected: { borderColor: theme.text },
  error: { color: theme.danger, fontSize: 13 },
  formButtons: { flexDirection: 'row', gap: 10 },
  addButton: { flex: 1, backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  addButtonDisabled: { opacity: 0.5 },
  addButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryButton: { flex: 1, backgroundColor: theme.surfaceAlt, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  secondaryButtonText: { color: theme.text, fontSize: 15, fontWeight: '600' },
})
