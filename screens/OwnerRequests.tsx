import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Alert, RefreshControl } from 'react-native';
import { supabase } from '../lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import HeaderBar from '../components/HeaderBar';

type PendingItem = {
  reservation_id: string;
  business_id: string;
  business_name: string;
  start_at: string;
  end_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  created_at: string;
};

export default function OwnerRequests() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id ?? null;

      const { data, error } = await supabase.rpc('owner_list_pending_reservations_json', {
        // puedes omitir payload y que use auth.uid():
        payload: uid ? { p_owner_user_id: uid } : {}
      });

      if (error) {
        console.warn('owner_list_pending_reservations_json', error.message);
        setItems([]);
      } else {
        setItems((data as PendingItem[]) ?? []);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const fmt = (iso: string) => {
    const d = new Date(iso);
    const datePart = d.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short' });
    const timePart = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    return `${datePart} · ${timePart}`;
    // si quieres ver exacto con segundos: toLocaleString('es-ES', { ... })
  };

  const accept = async (it: PendingItem) => {
    const { error } = await supabase.rpc('owner_accept_reservation', {
      p_business: it.business_id,
      p_reservation: it.reservation_id
    });
    if (error) {
      Alert.alert('No se pudo aceptar', error.message);
      return;
    }
    setItems(prev => prev.filter(x => x.reservation_id !== it.reservation_id));
  };

  const reject = async (it: PendingItem) => {
    Alert.alert('Rechazar solicitud', `¿Rechazar la reserva de ${it.customer_name ?? 'cliente'}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Rechazar', style: 'destructive', onPress: async () => {
          const { error } = await supabase.rpc('owner_cancel_reservation', {
            p_business: it.business_id,
            p_reservation: it.reservation_id
          });
          if (error) {
            Alert.alert('Error', error.message);
            return;
          }
          setItems(prev => prev.filter(x => x.reservation_id !== it.reservation_id));
        }
      }
    ]);
  };

  const renderItem = ({ item }: { item: PendingItem }) => {
    const init = (item.business_name?.[0] || '?').toUpperCase();
    return (
      <View style={styles.row}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{init}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{item.business_name}</Text>
          <Text style={styles.sub}>{fmt(item.start_at)}</Text>
          {(item.customer_name || item.customer_phone) && (
            <Text style={styles.sub} numberOfLines={1}>
              {item.customer_name ?? ''}{item.customer_phone ? (item.customer_name ? ' • ' : '') + item.customer_phone : ''}
            </Text>
          )}
        </View>
        <View style={styles.actions}>
          <TouchableOpacity onPress={() => accept(item)} style={[styles.iconBtn, { backgroundColor: '#1b5e20' }]} accessibilityLabel="Aceptar">
            <Feather name="check" size={16} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => reject(item)} style={[styles.iconBtn, { backgroundColor: '#c62828' }]} accessibilityLabel="Rechazar">
            <Feather name="x" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8, paddingBottom: 8 }]}>
      <HeaderBar title="Solicitudes" />
      {loading ? (
        <View style={styles.center}><ActivityIndicator /><Text style={{ marginTop: 8 }}>Cargando solicitudes…</Text></View>
      ) : items.length === 0 ? (
        <View style={styles.center}><Text>No hay solicitudes pendientes.</Text></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.reservation_id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:{flex:1,backgroundColor:'#fff'},
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fafafa', borderRadius: 12, borderWidth: 1, borderColor: '#eee',
    padding: 12, marginBottom: 10
  },
  avatar: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#e6e6e6', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarText: { fontWeight: '800', color: '#555' },
  title: { fontSize: 15, fontWeight: '800', color: '#111' },
  sub: { fontSize: 12, color: '#555', marginTop: 2 },
  actions: { flexDirection: 'row', marginLeft: 10 },
  iconBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, marginLeft: 6 },
});
