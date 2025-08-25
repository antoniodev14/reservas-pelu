// src/lib/clientToken.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const CLIENT_TOKEN_KEY = 'client_token';

// UUID v4 con expo-crypto (fallback si no hay randomUUID)
function uuidv4Fallback(): string {
  const bytes = Crypto.getRandomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/**
 * Devuelve SIEMPRE un string.
 * - Si existe en AsyncStorage → lo devuelve.
 * - Si no existe → crea uno nuevo, lo guarda y lo devuelve.
 */
export async function getOrCreateClientToken(): Promise<string> {
  const existing = await AsyncStorage.getItem(CLIENT_TOKEN_KEY); // string | null
  if (existing !== null) {
    return existing; // ← ya está estrechado a string
  }
  const newToken: string =
    (Crypto as any).randomUUID?.()   // Expo SDK 49+
    ?? uuidv4Fallback();             // fallback

  await AsyncStorage.setItem(CLIENT_TOKEN_KEY, newToken);
  return newToken;                   // ← siempre string
}

/** Lee el token sin crearlo. Devuelve string | null si no existe aún. */
export async function getClientTokenOrNull(): Promise<string | null> {
  return AsyncStorage.getItem(CLIENT_TOKEN_KEY);
}
