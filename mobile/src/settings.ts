import * as SecureStore from 'expo-secure-store'
import type { AiProvider } from './ai'

const KEYS = {
  provider: 'nertator.provider',
  openaiKey: 'nertator.openaiKey',
  openaiModel: 'nertator.openaiModel',
  geminiKey: 'nertator.geminiKey',
  geminiModel: 'nertator.geminiModel',
  aiPrompt: 'nertator.aiPrompt',
} as const

export type Settings = {
  provider: AiProvider
  openaiKey: string
  openaiModel: string
  geminiKey: string
  geminiModel: string
  aiPrompt: string
}

export async function getSettings(): Promise<Settings> {
  const [provider, openaiKey, openaiModel, geminiKey, geminiModel, aiPrompt] = await Promise.all([
    SecureStore.getItemAsync(KEYS.provider),
    SecureStore.getItemAsync(KEYS.openaiKey),
    SecureStore.getItemAsync(KEYS.openaiModel),
    SecureStore.getItemAsync(KEYS.geminiKey),
    SecureStore.getItemAsync(KEYS.geminiModel),
    SecureStore.getItemAsync(KEYS.aiPrompt),
  ])
  return {
    provider: provider === 'gemini' ? 'gemini' : 'openai',
    openaiKey: openaiKey || '',
    openaiModel: openaiModel || 'gpt-5-mini',
    geminiKey: geminiKey || '',
    geminiModel: geminiModel || 'gemini-2.5-flash',
    aiPrompt: aiPrompt || '',
  }
}

export async function setSetting(key: keyof typeof KEYS, value: string) {
  await SecureStore.setItemAsync(KEYS[key], value)
}
