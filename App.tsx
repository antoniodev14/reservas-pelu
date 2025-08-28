import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import Home from './screens/home';
import BusinessDetail from './screens/BusinessDetail';
import OwnerSettings from './screens/OwnerSettings';
import OwnerRequests from './screens/OwnerRequests';
import OwnerClientList from './screens/OwnerClientList';
import OwnerServices from './screens/OwnerServices';
import { supabase } from './lib/supabase';

export type RootStackParamList = {
  Inicio: undefined;
  BusinessDetail: { businessId: string; name: string };
};

export type OwnerTabParamList = {
  OwnerHome: undefined;
  OwnerManage: undefined;
  OwnerRequests: undefined;
  OwnerClientList: undefined;
  OwnerServices: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<OwnerTabParamList>();

function OwnerTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#111',
        tabBarInactiveTintColor: '#666',
        tabBarStyle: { borderTopColor: '#eee', borderTopWidth: 1 },
      }}
    >
      <Tab.Screen
        name="OwnerHome"
        component={Home}
        options={{
          tabBarLabel: 'Inicio',
          tabBarIcon: ({ color, size }) => <Feather name="home" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="OwnerClientList"
        component={OwnerClientList}
        options={{
          title: 'Lista clientes',
          tabBarIcon: ({ color, size }) => <Feather name="scissors" color={color} size={size} />, // ✂️
        }}
      />
      <Tab.Screen
        name="OwnerRequests"
        component={OwnerRequests}
        options={{
          title: 'Solicitudes',
          // icono de “solicitud/entrada”: usa el que más te guste
          tabBarIcon: ({ color, size }) => <Feather name="inbox" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="OwnerManage"
        component={OwnerSettings}
        options={{
          tabBarLabel: 'Gestion',
          tabBarIcon: ({ color, size }) => <Feather name="user" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="OwnerServices"
        component={OwnerServices}
        options={{
          title: 'Servicios',
          tabBarIcon: ({ color, size }) => <Feather name="list" color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [isOwnerSession, setIsOwnerSession] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    const computeIsOwner = async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (!uid) {
        mounted && setIsOwnerSession(false);
        return;
      }
      const { data: rows } = await supabase
        .from('businesses')
        .select('id')
        .eq('owner_user_id', uid)
        .limit(1);
      mounted && setIsOwnerSession((rows?.length ?? 0) > 0);
    };

    computeIsOwner();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      (async () => {
        const uid = sess?.user?.id;
        if (!uid) { setIsOwnerSession(false); return; }
        const { data: rows } = await supabase
          .from('businesses')
          .select('id')
          .eq('owner_user_id', uid)
          .limit(1);
        setIsOwnerSession((rows?.length ?? 0) > 0);
      })();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style={Platform.OS === 'android' ? 'light' : 'dark'} translucent />
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fff' } }}>
          {isOwnerSession ? (
            <>
              <Stack.Screen name="Inicio" component={OwnerTabs} />
              <Stack.Screen name="BusinessDetail" component={BusinessDetail} />
            </>
          ) : (
            <>
              <Stack.Screen name="Inicio" component={Home} />
              <Stack.Screen name="BusinessDetail" component={BusinessDetail} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
