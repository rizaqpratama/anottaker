import './src/id'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { parseImports, toJsonl, uid, validateSpan } from '@nertator/shared'
import type { AiSuggestion, DatasetDocument, DocumentStatus, Project } from '@nertator/shared'
import { suggestEntities } from './src/ai'
import { ProjectStore } from './src/db/ProjectStore'
import { getSettings } from './src/settings'
import { Annotator } from './src/screens/Annotator'
import { DocumentQueue } from './src/screens/DocumentQueue'
import { LabelsModal } from './src/screens/Labels'
import { SettingsModal } from './src/screens/Settings'
import { Welcome } from './src/screens/Welcome'
import { theme } from './src/theme'

export default function App() {
  const [store, setStore] = useState<ProjectStore | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [doc, setDoc] = useState<DatasetDocument | null>(null)
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([])
  const [screen, setScreen] = useState<'queue' | 'annotator'>('queue')
  const [showLabels, setShowLabels] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)

  useEffect(() => {
    ProjectStore.open().then(async (opened) => {
      setStore(opened)
      setProject(await opened.snapshot())
    })
  }, [])

  if (!store || !project) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    )
  }

  const refreshProject = async (page = project.page) => setProject(await store.snapshot(page, project.pageSize))
  const refreshDoc = async (id: string) => setDoc(await store.getDocument(id))

  const onCreate = async (name: string) => {
    setBusy(true)
    try {
      await store.initialize(name)
      await refreshProject(0)
    } finally {
      setBusy(false)
    }
  }

  if (!project.name) {
    return (
      <View style={styles.root}>
        <Welcome onCreate={onCreate} busy={busy} />
        <StatusBar style="light" />
      </View>
    )
  }

  const onImport = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: ['text/plain', 'text/csv', 'application/json', '*/*'], copyToCacheDirectory: true })
    if (picked.canceled || !picked.assets[0]) return
    const asset = picked.assets[0]
    setBusy(true)
    try {
      const contents = await new File(asset.uri).text()
      const texts = parseImports(asset.name, contents)
      await store.addDocuments(texts)
      await refreshProject(0)
    } catch (err) {
      Alert.alert('Import failed', err instanceof Error ? err.message : 'Could not import this file.')
    } finally {
      setBusy(false)
    }
  }

  const onExport = async () => {
    setBusy(true)
    try {
      const documents = await store.getAllDocumentsWithEntities(false)
      const jsonl = toJsonl(documents, project.labels)
      const file = new File(Paths.cache, 'dataset.jsonl')
      file.create({ overwrite: true })
      file.write(jsonl)
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri)
      else Alert.alert('Export ready', `Saved to ${file.uri}`)
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Could not export this project.')
    } finally {
      setBusy(false)
    }
  }

  const onOpenDoc = async (target: DatasetDocument) => {
    await refreshDoc(target.id)
    setSuggestions([])
    setScreen('annotator')
  }

  const onAddEntity = async (start: number, end: number, labelId: string) => {
    if (!doc) return
    await store.addEntity({ id: uid(), documentId: doc.id, start, end, labelId })
    await refreshDoc(doc.id)
    await refreshProject()
  }

  const onRemoveEntity = async (id: string) => {
    if (!doc) return
    await store.removeEntity(id)
    await refreshDoc(doc.id)
  }

  const onClearEntities = async () => {
    if (!doc) return
    await store.clearEntities(doc.id)
    await refreshDoc(doc.id)
  }

  const onDeleteDocument = async () => {
    if (!doc) return
    await store.deleteDocument(doc.id)
    setDoc(null)
    setScreen('queue')
    await refreshProject()
  }

  const onSetStatus = async (status: DocumentStatus) => {
    if (!doc) return
    await store.setStatus(doc.id, status)
    await refreshDoc(doc.id)
    await refreshProject()
  }

  const onSuggest = async () => {
    if (!doc) return
    const settings = await getSettings()
    const apiKey = settings.provider === 'gemini' ? settings.geminiKey : settings.openaiKey
    if (!apiKey) {
      Alert.alert('Add an API key', `Add a ${settings.provider === 'gemini' ? 'Gemini' : 'OpenAI'} API key in AI settings first.`)
      return
    }
    setAiBusy(true)
    try {
      const result = await suggestEntities({
        documentText: doc.text,
        labels: project.labels,
        provider: settings.provider,
        model: settings.provider === 'gemini' ? settings.geminiModel : settings.openaiModel,
        apiKey,
        customInstructions: settings.aiPrompt,
      })
      setSuggestions(result.suggestions)
    } catch (err) {
      Alert.alert('AI request failed', err instanceof Error ? err.message : 'Could not get suggestions.')
    } finally {
      setAiBusy(false)
    }
  }

  const onAcceptSuggestion = async (suggestion: AiSuggestion) => {
    if (!doc) return
    const label = project.labels.find((item) => item.name === suggestion.label)
    if (!label) return
    const message = validateSpan(doc.text, suggestion, doc.entities)
    if (message) return
    await onAddEntity(suggestion.start, suggestion.end, label.id)
    setSuggestions((current) => current.filter((item) => item.id !== suggestion.id))
  }

  const onAcceptAllSuggestions = async () => {
    if (!doc) return
    let existing = doc.entities
    for (const suggestion of suggestions) {
      const label = project.labels.find((item) => item.name === suggestion.label)
      if (!label) continue
      if (validateSpan(doc.text, suggestion, existing)) continue
      const entity = { id: uid(), documentId: doc.id, start: suggestion.start, end: suggestion.end, labelId: label.id }
      await store.addEntity(entity)
      existing = [...existing, entity]
    }
    setSuggestions([])
    await refreshDoc(doc.id)
    await refreshProject()
  }

  return (
    <View style={styles.root}>
      {screen === 'annotator' && doc ? (
        <Annotator
          doc={doc}
          labels={project.labels}
          suggestions={suggestions}
          aiBusy={aiBusy}
          onBack={() => setScreen('queue')}
          onAddEntity={onAddEntity}
          onRemoveEntity={onRemoveEntity}
          onClearEntities={onClearEntities}
          onDeleteDocument={onDeleteDocument}
          onSetStatus={onSetStatus}
          onSuggest={onSuggest}
          onAcceptSuggestion={onAcceptSuggestion}
          onAcceptAllSuggestions={onAcceptAllSuggestions}
        />
      ) : (
        <DocumentQueue
          project={project}
          busy={busy}
          onOpenDoc={onOpenDoc}
          onPage={refreshProject}
          onImport={onImport}
          onExport={onExport}
          onOpenLabels={() => setShowLabels(true)}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}

      <LabelsModal
        visible={showLabels}
        labels={project.labels}
        onClose={() => setShowLabels(false)}
        onAdd={async (label) => {
          await store.addLabel(label)
          await refreshProject()
        }}
        onUpdate={async (label) => {
          await store.updateLabel(label)
          await refreshProject()
        }}
        onRemove={async (id) => {
          await store.removeLabel(id)
          await refreshProject()
        }}
      />
      <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />

      <StatusBar style="light" />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  loading: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
})
