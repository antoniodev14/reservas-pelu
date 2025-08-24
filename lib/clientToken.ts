import AsyncStorage from '@react-native-async-storage/async-storage';

// Generar un UUID sencillo sin dependencias extra
function simpleUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const KEY = 'client_token_v1';

export async function getClientToken(): Promise<string> {
  let t = await AsyncStorage.getItem(KEY);
  if (!t) {
    t = simpleUUID();
    await AsyncStorage.setItem(KEY, t);
  }
  return t;
}
