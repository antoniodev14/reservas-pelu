import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../App';
import { supabase } from '../lib/supabase';
// Si más adelante quieres "Tu reserva", reactivas el token.
// import { getOrCreateClientToken } from '../lib/clientToken';

type RouteProps = RouteProp<RootStackParamList, 'BusinessDetail'>;

type Slot = {
  start_at: string;
  end_at: string;
  is_free: boolean;
  is_mine: boolean;
  mine_name: string | null;
  mine_phone: string | null;
  reservation_id: string | null;
  occupant_name: string | null;
  occupant_phone: string | null;
};

function fmtHM(dateIso: string) {
  const iso = dateIso.includes('T') ? dateIso : dateIso.replace(' ', 'T');
  const d = new Date(iso);
  if (isNaN(d.getTime())) return dateIso;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function addDays(date: Date, days: number) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function ymd(d: Date) {
  const y = d.getFullYear(); const m = (d.getMonth() + 1).toString().padStart(2, '0'); const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const weekdayShort = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

export default function BusinessDetail() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation();
  const { businessId, name } = route.params;

  const [selectedDayIdx, setSelectedDayIdx] = useState(0);
  const days = useMemo(() => Array.from({ length: 7 }).map((_, i) => addDays(new Date(), i)), []);
  const selectedDate = days[selectedDayIdx];

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOwner, setIsOwner] = useState(false);

  // Detectar si el usuario autenticado es el dueño de este negocio
  const checkOwner = useCallback(async () => {
    const [{ data: sess }, { data, error }] = await Promise.all([
      supabase.auth.getSession(),
      supabase.from('businesses').select('owner_user_id').eq('id', businessId).single()
    ]);
    const uid = sess?.session?.user?.id;
    if (!error && data && uid && data.owner_user_id === uid) setIsOwner(true);
    else setIsOwner(false);
  }, [businessId]);

  // Cargar slots (NO dependemos de client_token para estabilidad)
  const fetchSlots = useCallback(async (targetDate: Date = selectedDate) => {
    try {
      setLoading(true);
      const dateStr = ymd(targetDate);
      const { data, error } = await supabase.rpc('get_day_slots', {
        p_business: businessId,
        p_date: dateStr,
        p_client_token: null, // estable; más adelante, si quieres, pasamos el client_token real
      });
      if (error) {
        console.warn('[get_day_slots] error:', error.message, { businessId, dateStr });
        setSlots([]);
      } else if (Array.isArray(data)) {
        setSlots(data as Slot[]);
      } else {
        setSlots([]);
      }
    } catch (e: any) {
      console.warn('[get_day_slots] EXCEPTION:', e?.message || e);
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, [businessId, selectedDate]);

  // Recargar al entrar en la pantalla
  useFocusEffect(useCallback(() => {
    checkOwner();
    fetchSlots(selectedDate);
  }, [checkOwner, fetchSlots, selectedDate]));

  // Recargar cuando cambia el día
  useEffect(() => { fetchSlots(selectedDate); }, [selectedDayIdx, fetchSlots, selectedDate]);

  // Cancelación del dueño (✕)
  const onOwnerCancel = useCallback(async (reservationId: string) => {
    try {
      const { error } = await supabase.rpc('owner_cancel_reservation', {
        p_business: businessId,
        p_reservation: reservationId,
      });
      if (error) {
        console.warn('owner_cancel_reservation error:', error.message);
        return;
      }
      await fetchSlots(); // refresca
    } catch (e: any) {
      console.warn('onOwnerCancel EX:', e?.message || e);
    }
  }, [businessId, fetchSlots]);

  const renderSlot = ({ item }: { item: Slot }) => {
    const start = fmtHM(item.start_at);
    const end = fmtHM(item.end_at);
    const busy = !item.is_free;

    return (
      <View style={[styles.slotRow, busy ? styles.slotBusy : styles.slotFree]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent:'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={styles.slotTime}>{start}</Text>
            <Text style={styles.slotTo}>{'  -  '}</Text>
            <Text style={styles.slotTimeEnd}>{end}</Text>
          </View>

          {isOwner && busy && item.reservation_id && (
            <TouchableOpacity onPress={() => onOwnerCancel(item.reservation_id!)} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {busy ? (
          isOwner ? (
            <Text style={styles.ownerPII}>
              {item.occupant_name || 'Reserva'}{item.occupant_phone ? ` · ${item.occupant_phone}` : ''}
            </Text>
          ) : item.is_mine ? (
            <Text style={styles.mineText}>
              Tu reserva{item.mine_name ? ` · ${item.mine_name}` : ''}{item.mine_phone ? ` · ${item.mine_phone}` : ''}
            </Text>
          ) : (
            <Text style={styles.busyText}>Ocupado</Text>
          )
        ) : (
          <Text style={styles.freeText}>Libre</Text>
        )}
      </View>
    );
  };

  const daysHeader = (
    <View style={styles.daysRow}>
      {days.map((d, i) => {
        const wd = weekdayShort[d.getDay()];
        const dayNum = d.getDate();
        const sel = i === selectedDayIdx;
        return (
          <TouchableOpacity key={i} onPress={() => setSelectedDayIdx(i)} style={[styles.dayChip, sel && styles.dayChipSel]}>
            <Text style={[styles.dayChipText, sel && styles.dayChipTextSel]}>{wd}</Text>
            <Text style={[styles.dayChipSub, sel && styles.dayChipTextSel]}>{dayNum}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (navigation as any).goBack()}>
          <Text style={styles.back}>&lt; Volver</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{name}</Text>
        <View style={{ width: 64 }} />
      </View>

      {daysHeader}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text style={{ marginTop: 8 }}>Cargando horarios…</Text>
        </View>
      ) : (
        <FlatList
          data={slots}
          keyExtractor={(s) => s.start_at}
          renderItem={renderSlot}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={
            <View style={{ padding: 16 }}>
              <Text>No hay horario configurado para este día.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 56, backgroundColor: '#fff' },
  header: {
    paddingHorizontal: 16, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 14, color: '#333' },
  title: { fontSize: 18, fontWeight: '700' },

  daysRow: { flexDirection: 'row', paddingHorizontal: 12, marginVertical: 6 },
  dayChip: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10,
    backgroundColor: '#f2f2f2', marginHorizontal: 4
  },
  dayChipSel: { backgroundColor: '#111' },
  dayChipText: { color: '#333', fontWeight: '700' },
  dayChipTextSel: { color: '#fff' },
  dayChipSub: { color: '#666', fontSize: 12 },

  loading: { padding: 16, alignItems: 'center' },

  slotRow: {
    marginHorizontal: 16, marginTop: 10, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1
  },
  slotFree: { borderColor: '#cfead6', backgroundColor: '#f3fff6' },
  slotBusy: { borderColor: '#f1c7c7', backgroundColor: '#fff5f5' },

  slotTime: { fontSize: 16, fontWeight: '700' },
  slotTo: { color: '#999' },
  slotTimeEnd: { fontSize: 16, fontWeight: '600' },

  freeText: { marginTop: 4, color: '#2e7d32', fontWeight: '600' },
  busyText: { marginTop: 4, color: '#b71c1c', fontWeight: '600' },
  mineText: { marginTop: 4, color: '#1a237e', fontWeight: '700' },

  // Dueño
  cancelBtn: { backgroundColor:'#111', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  cancelBtnText: { color:'#fff', fontWeight:'800', fontSize:16 },
  ownerPII: { marginTop: 4, color:'#111', fontWeight:'700' },
});
