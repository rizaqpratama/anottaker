import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { theme } from '../theme'

export function Welcome({ onCreate, busy }: { onCreate: (name: string) => void; busy: boolean }) {
  const [name, setName] = useState('')

  return (
    <View style={styles.container}>
      <Text style={styles.title}>NERTator</Text>
      <Text style={styles.subtitle}>Build a named-entity annotation dataset on the go.</Text>
      <TextInput
        style={styles.input}
        placeholder="Project name"
        placeholderTextColor={theme.textMuted}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
      />
      <Pressable
        style={[styles.button, (!name.trim() || busy) && styles.buttonDisabled]}
        disabled={!name.trim() || busy}
        onPress={() => onCreate(name.trim())}
      >
        {busy ? <ActivityIndicator color={theme.text} /> : <Text style={styles.buttonText}>Create project</Text>}
      </Pressable>
      <Text style={styles.hint}>
        Mobile keeps one project on this device. Import documents from the queue screen, and export
        JSONL from there when you're done reviewing.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  title: { color: theme.text, fontSize: 32, fontWeight: '700' },
  subtitle: { color: theme.textMuted, fontSize: 15, textAlign: 'center' },
  input: { width: '100%', backgroundColor: theme.surface, color: theme.text, borderRadius: 10, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  button: { width: '100%', backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  hint: { color: theme.textMuted, fontSize: 13, textAlign: 'center', marginTop: 8 },
})
