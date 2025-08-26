import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import HeaderBar from '../components/HeaderBar';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Row = {
  reservation_id: string;
  business_id: string;
  business_name: string;
  start_at: string;
  end_at: string;
  customer_name: string | null;
  customer_phone: string | null;
};

export default function OwnerClientList() {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id ?? null;

      const { data, error } = await supabase.rpc('owner_list_upcoming_accepted_json', {
        payload: uid ? { p_owner_user_id: uid } : {}
        // Si quieres filtrar por una pelu concreta:
        // payload: { p_owner_user_id: uid, p_business_id: 'xxxxxxxx-xxxx-....' }
      });

      if (error) {
        console.warn('owner_list_upcoming_accepted_json', error.message);
        setItems([]);
      } else {
        setItems((data as Row[]) ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // refresca al enfocar
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // cada minuto limpia las que ya hayan terminado por si justo pasan
  useEffect(() => {
    const id = setInterval(() => {
      setItems(prev => prev.filter(x => new Date(x.end_at).getTime() > Date.now()));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    const date = d.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short' });
    const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    return `${date} · ${time}`;
  };

  const cancel = async (row: Row) => {
    Alert.alert('Anular cita', `¿Anular la cita de ${row.customer_name ?? 'cliente'}?`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Sí, anular', style: 'destructive', onPress: async () => {
          const { error } = await supabase.rpc('owner_cancel_reservation', {
            p_business: row.business_id,
            p_reservation: row.reservation_id
          });
          if (error) { Alert.alert('Error', error.message); return; }
          setItems(prev => prev.filter(x => x.reservation_id !== row.reservation_id));
        }
      }
    ]);
  };

  const renderItem = ({ item }: { item: Row }) => {
    const end = new Date(item.end_at);
    const start = new Date(item.start_at);
    const hour = start.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const hourEnd = end.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const fullDate = start.toLocaleDateString('es-ES', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    });

    return (
      <View style={styles.card}>
        <View style={{ flex: 1 }}>
            {/* Tramo horario grande */}
            <Text style={styles.hourText}>{hour} – {hourEnd}</Text>

            {/* Nombre + teléfono grandes */}
            <Text style={styles.clientText}>
            {item.customer_name ?? 'Cliente'}{item.customer_phone ? ` • ${item.customer_phone}` : ''}
            </Text>

            {/* Fecha pequeña */}
            <Text style={styles.dateText}>{fullDate}</Text>
        </View>

        {/* Botón anular */}
        <TouchableOpacity onPress={() => cancel(item)} style={[styles.iconBtn, { backgroundColor: '#c62828' }]}>
            <Feather name="x" size={18} color="#fff" />
        </TouchableOpacity>
    </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <HeaderBar title="Panel del dueño" rightLabel="Salir" onRightPress={async ()=>{ await supabase.auth.signOut(); }} />
      {loading ? (
        <View style={styles.center}><ActivityIndicator /><Text style={{ marginTop: 8 }}>Cargando…</Text></View>
      ) : items.length === 0 ? (
        <View style={styles.center}><Text>No hay citas aceptadas próximas.</Text></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.reservation_id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fafafa',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eee',
    padding: 14,
    marginBottom: 12,
  },

  hourText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111',
    marginBottom: 4,
  },
  clientText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#222',
    marginBottom: 2,
  },
  dateText: {
    fontSize: 12,
    color: '#666',
  },

  iconBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginLeft: 12,
    alignSelf: 'flex-start',
  },
});
