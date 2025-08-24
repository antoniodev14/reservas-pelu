// App.tsx
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, Platform } from 'react-native';
import Home from './screens/home';

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1, paddingTop: Platform.OS === 'android' ? 24 : 0 }}>
      <StatusBar style="dark" />
      <Home />
    </SafeAreaView>
  );
}
