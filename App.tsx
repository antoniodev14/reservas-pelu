import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import Home from './screens/home';
import BusinessDetail from './screens/BusinessDetail';

export type RootStackParamList = {
  Home: undefined;
  BusinessDetail: { businessId: string; name: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1, paddingTop: Platform.OS === 'android' ? 24 : 0 }}>
      <StatusBar style="dark" />
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Home" component={Home} />
          <Stack.Screen name="BusinessDetail" component={BusinessDetail} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaView>
  );
}
