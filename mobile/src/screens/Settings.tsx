import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import type { AiProvider } from '../ai'
import { listOpenAiModels } from '../ai/openai'
import { getSettings, setSetting, type Settings } from '../settings'
import { theme } from '../theme'

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite']
const OPENAI_DEFAULT_MODELS = ['gpt-5-mini', 'gpt-5', 'gpt-5-nano']

export function SettingsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [openaiKeyInput, setOpenaiKeyInput] = useState('')
  const [geminiKeyInput, setGeminiKeyInput] = useState('')
  const [openaiModels, setOpenaiModels] = useState(OPENAI_DEFAULT_MODELS)
  const [loadingModels, setLoadingModels] = useState(false)
  const [detail, setDetail] = useState('')

  useEffect(() => {
    if (!visible) return
    getSettings().then(setSettings)
  }, [visible])

  if (!settings) return null

  const isGemini = settings.provider === 'gemini'

  const loadOpenAiModels = async () => {
    if (!openaiKeyInput) return
    setLoadingModels(true)
    try {
      setOpenaiModels(await listOpenAiModels(openaiKeyInput))
    } catch (err) {
      setDetail(err instanceof Error ? err.message : 'Could not load models.')
    } finally {
      setLoadingModels(false)
    }
  }

  const save = async () => {
    await setSetting('provider', settings.provider)
    await setSetting('aiPrompt', settings.aiPrompt)
    if (isGemini) {
      if (geminiKeyInput) await setSetting('geminiKey', geminiKeyInput)
      await setSetting('geminiModel', settings.geminiModel)
    } else {
      if (openaiKeyInput) await setSetting('openaiKey', openaiKeyInput)
      await setSetting('openaiModel', settings.openaiModel)
    }
    setOpenaiKeyInput('')
    setGeminiKeyInput('')
    setDetail('Settings saved.')
  }

  const setProvider = (provider: AiProvider) => setSettings({ ...settings, provider })

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>AI settings</Text>
          <Pressable onPress={onClose}>
            <Text style={styles.close}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.label}>Provider</Text>
          <View style={styles.segmented}>
            <Pressable style={[styles.segment, !isGemini && styles.segmentActive]} onPress={() => setProvider('openai')}>
              <Text style={[styles.segmentText, !isGemini && styles.segmentTextActive]}>OpenAI</Text>
            </Pressable>
            <Pressable style={[styles.segment, isGemini && styles.segmentActive]} onPress={() => setProvider('gemini')}>
              <Text style={[styles.segmentText, isGemini && styles.segmentTextActive]}>Gemini</Text>
            </Pressable>
          </View>

          {isGemini ? (
            <>
              <Text style={styles.label}>Gemini API key</Text>
              <TextInput style={styles.input} placeholder="AIza..." placeholderTextColor={theme.textMuted} secureTextEntry value={geminiKeyInput} onChangeText={setGeminiKeyInput} autoCapitalize="none" />
              <Text style={styles.label}>Model</Text>
              <View style={styles.modelList}>
                {GEMINI_MODELS.map((model) => (
                  <Pressable key={model} style={[styles.modelChip, settings.geminiModel === model && styles.modelChipActive]} onPress={() => setSettings({ ...settings, geminiModel: model })}>
                    <Text style={[styles.modelChipText, settings.geminiModel === model && styles.modelChipTextActive]}>{model}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>OpenAI API key</Text>
              <TextInput style={styles.input} placeholder="sk-..." placeholderTextColor={theme.textMuted} secureTextEntry value={openaiKeyInput} onChangeText={setOpenaiKeyInput} autoCapitalize="none" />
              <View style={styles.rowBetween}>
                <Text style={styles.label}>Model</Text>
                <Pressable onPress={loadOpenAiModels} disabled={!openaiKeyInput || loadingModels}>
                  {loadingModels ? <ActivityIndicator color={theme.accent} /> : <Text style={styles.loadModels}>Load models</Text>}
                </Pressable>
              </View>
              <View style={styles.modelList}>
                {openaiModels.map((model) => (
                  <Pressable key={model} style={[styles.modelChip, settings.openaiModel === model && styles.modelChipActive]} onPress={() => setSettings({ ...settings, openaiModel: model })}>
                    <Text style={[styles.modelChipText, settings.openaiModel === model && styles.modelChipTextActive]}>{model}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text style={styles.label}>Custom annotation instructions</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="Optional guidance appended to the base NER prompt"
            placeholderTextColor={theme.textMuted}
            multiline
            value={settings.aiPrompt}
            onChangeText={(aiPrompt) => setSettings({ ...settings, aiPrompt })}
          />

          <Text style={styles.hint}>
            NERTator mobile does not support local coding-agent providers (Codex, Claude Code, Cursor, etc.) — those
            spawn CLI processes and only make sense on desktop. Keys are stored in this device's secure keychain and
            never leave it except in requests you send to OpenAI or Google.
          </Text>

          {detail ? <Text style={styles.detail}>{detail}</Text> : null}
          <Pressable style={styles.saveButton} onPress={save}>
            <Text style={styles.saveButtonText}>Save settings</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, paddingTop: 60, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { color: theme.text, fontSize: 22, fontWeight: '700' },
  close: { color: theme.accent, fontSize: 16, fontWeight: '600' },
  body: { paddingBottom: 40, gap: 8 },
  label: { color: theme.textMuted, fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 6, textTransform: 'uppercase' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  segmented: { flexDirection: 'row', backgroundColor: theme.surfaceAlt, borderRadius: 10, padding: 4 },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  segmentActive: { backgroundColor: theme.accent },
  segmentText: { color: theme.textMuted, fontWeight: '600' },
  segmentTextActive: { color: '#fff' },
  input: { backgroundColor: theme.surface, color: theme.text, borderRadius: 10, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  modelList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modelChip: { backgroundColor: theme.surfaceAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  modelChipActive: { backgroundColor: theme.accent },
  modelChipText: { color: theme.textMuted, fontSize: 13 },
  modelChipTextActive: { color: '#fff' },
  loadModels: { color: theme.accent, fontWeight: '600' },
  hint: { color: theme.textMuted, fontSize: 12, marginTop: 16, lineHeight: 18 },
  detail: { color: theme.accent, fontSize: 13, marginTop: 12 },
  saveButton: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
