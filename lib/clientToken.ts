import * as SecureStore from 'expo-secure-store';
import uuid from 'react-native-uuid';

const KEY = 'client_token';

export async function getOrCreateClientToken(): Promise<string> {
  let token = await SecureStore.getItemAsync(KEY);
  if (!token) {
    token = uuid.v4().toString();
    await SecureStore.setItemAsync(KEY, token);
  }
  return token;
}
