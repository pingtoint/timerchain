/**
 * AI 直连设置的持久化：提供方 + API Key。
 *
 * Key 属于敏感信息，走 expo-secure-store（系统级加密存储），
 * 不进 SQLite、不进 AsyncStorage。
 */

import * as SecureStore from 'expo-secure-store';

import type { AiSettings } from './provider';

const KEY_PROVIDER = 'ai_provider_id';
const KEY_API_KEY = 'ai_api_key';

export async function loadAiSettings(): Promise<AiSettings | null> {
  const [providerId, apiKey] = await Promise.all([
    SecureStore.getItemAsync(KEY_PROVIDER),
    SecureStore.getItemAsync(KEY_API_KEY),
  ]);
  if (providerId === null || apiKey === null || apiKey.length === 0) {
    return null;
  }
  return { providerId, apiKey };
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY_PROVIDER, settings.providerId),
    SecureStore.setItemAsync(KEY_API_KEY, settings.apiKey),
  ]);
}

export async function clearAiSettings(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_PROVIDER),
    SecureStore.deleteItemAsync(KEY_API_KEY),
  ]);
}
