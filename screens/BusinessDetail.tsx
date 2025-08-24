import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet, Modal } from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../App';
import { supabase } from '../lib/supabase';
import { Feather } from '@expo/vector-icons';
import HeaderBar from '../components/HeaderBar';

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
  occupant_status: 'pending' | 'accepted' | null;
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
function buildNextDays(totalDays = 60) {
  const arr: Date[] = [];
  for (let i = 0; i < totalDays; i++) arr.push(addDays(new Date(), i));
  return arr;
}

export default function BusinessDetail() {
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProps>();
  const navigation = useNavigation();
  const { businessId, name } = route.params;

  const days = useMemo(() => buildNextDays(60), []);
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);
  const selectedDate = days[selectedDayIdx];

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOwner, setIsOwner] = useState(false);

  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string | null } | null>(null);

  const daysListRef = useRef<FlatList<Date>>(null);

  const checkOwner = useCallback(async () => {
    const [{ data: sess }, { data, error }] = await Promise.all([
      supabase.auth.getSession(),
      supabase.from('businesses').select('owner_user_id').eq('id', businessId).single()
    ]);
    const uid = sess?.session?.user?.id;
    if (!error && data && uid && data.owner_user_id === uid) setIsOwner(true);
    else setIsOwner(false);
  }, [businessId]);

  const fetchSlots = useCallback(async (targetDate: Date = selectedDate) => {
    try {
      setLoading(true);
      const dateStr = ymd(targetDate);
      const { data, error } = await supabase.rpc('get_day_slots', {
        p_business: businessId,
        p_date: dateStr,
        p_client_token: null,
      });
      if (error) {
        console.warn('[get_day_slots] error:', error.message, { businessId, dateStr });
        setSlots([]);
      } else if (Array.isArray(data)) {
        const rows = (data as any[]).map(r => ({
          ...r,
          occupant_status: r.occupant_status ?? null,
        })) as Slot[];
        setSlots(rows);
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

  useFocusEffect(React.useCallback(() => {
    checkOwner();
    fetchSlots(selectedDate);
  }, [checkOwner, fetchSlots, selectedDate]));

  useEffect(() => { fetchSlots(selectedDate); }, [selectedDayIdx, fetchSlots, selectedDate]);

  const onOwnerAccept = useCallback(async (reservationId: string) => {
    try {
      const { error } = await supabase.rpc('owner_accept_reservation', {
        p_business: businessId,
        p_reservation: reservationId,
      });
      if (error) {
        console.warn('owner_accept_reservation error:', error.message);
        return;
      }
      await fetchSlots();
    } catch (e: any) {
      console.warn('onOwnerAccept EX:', e?.message || e);
    }
  }, [businessId, fetchSlots]);

  const askDelete = (reservationId: string, name: string | null) => {
    setConfirmTarget({ id: reservationId, name: name || null });
    setConfirmVisible(true);
  };

  const confirmDeleteNow = useCallback(async () => {
    if (!confirmTarget) return;
    try {
      const { error } = await supabase.rpc('owner_delete_reservation', {
        p_business: businessId,
        p_reservation: confirmTarget.id,
      });
      if (error) {
        console.warn('owner_delete_reservation error:', error.message);
        return;
      }
      setConfirmVisible(false);
      setConfirmTarget(null);
      await fetchSlots();
    } catch (e: any) {
      console.warn('owner_delete_reservation EX:', e?.message || e);
    }
  }, [businessId, confirmTarget, fetchSlots]);

  const renderSlot = ({ item }: { item: Slot }) => {
    const start = fmtHM(item.start_at);
    const end = fmtHM(item.end_at);
    const busy = !item.is_free;
    const isPending = busy && item.occupant_status === 'pending';
    const rowStyle = isPending ? styles.slotPending : (busy ? styles.slotBusy : styles.slotFree);

    return (
      <View style={[styles.slotRow, rowStyle]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent:'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={styles.slotTime}>{start}</Text>
            <Text style={styles.slotTo}>{'  -  '}</Text>
            <Text style={styles.slotTimeEnd}>{end}</Text>
          </View>
          {isOwner && busy && item.reservation_id && (
            <View style={{ flexDirection:'row' }}>
              {isPending && (
                <TouchableOpacity onPress={() => onOwnerAccept(item.reservation_id!)} style={styles.acceptBtn}>
                  <Feather name="check" size={16} color="#fff" />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => askDelete(item.reservation_id!, item.occupant_name)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {busy ? (
          isOwner ? (
            <Text style={styles.ownerPII}>
              {item.occupant_name || 'Reserva'}{item.occupant_phone ? ` · ${item.occupant_phone}` : ''}
              {isPending ? ' · PENDIENTE' : ''}
            </Text>
          ) : item.is_mine ? (
            <Text style={styles.mineText}>
              Tu reserva{item.mine_name ? ` · ${item.mine_name}` : ''}{item.mine_phone ? ` · ${item.mine_phone}` : ''}
            </Text>
          ) : (
            <Text style={styles.busyText}>{isPending ? 'Pendiente' : 'Ocupado'}</Text>
          )
        ) : (
          <Text style={styles.freeText}>Libre</Text>
        )}
      </View>
    );
  };

  const renderDayChip = ({ item, index }: { item: Date; index: number }) => {
    const wd = weekdayShort[item.getDay()];
    const dayNum = item.getDate().toString().padStart(2,'0');
    const month = item.toLocaleDateString(undefined, { month: 'short' }).replace('.', '');
    const sel = index === selectedDayIdx;

    return (
      <TouchableOpacity onPress={() => setSelectedDayIdx(index)} style={[styles.dayChip, sel && styles.dayChipSel]}>
        <Text style={[styles.dayChipText, sel && styles.dayChipTextSel]}>{wd}</Text>
        <Text style={[styles.dayChipSub, sel && styles.dayChipTextSel]}>{dayNum} {month}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 8) }]}>
      <HeaderBar
        title={name}
        leftLabel="Volver"
        leftIcon="chevron-left"
        onLeftPress={() => (navigation as any).goBack()}
      />

      <FlatList
        horizontal
        data={days}
        keyExtractor={(d) => d.toISOString().slice(0,10)}
        renderItem={renderDayChip}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 4 }}
        getItemLayout={(_, index) => ({ length: 76, offset: 76 * index, index })}
        initialScrollIndex={0}
        ref={daysListRef}
      />

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

      <Modal
        visible={confirmVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setConfirmVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirmar</Text>
            <Text style={{ marginTop: 6 }}>
              ¿Seguro que quieres borrar la cita{confirmTarget?.name ? ` de ${confirmTarget.name}` : ''}?
            </Text>
            <View style={{ flexDirection:'row', justifyContent:'flex-end', gap: 12, marginTop: 18 }}>
              <TouchableOpacity onPress={() => setConfirmVisible(false)} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmDeleteNow} style={styles.dangerBtn}>
                <Text style={styles.dangerBtnText}>Borrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  // Chips compactos (evitan solape con lista)
  dayChip: {
    width: 68, height: 48,
    marginHorizontal: 4,
    marginTop: 4,
    marginBottom: 8,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#f2f2f2',
    borderWidth: 1, borderColor: '#000',
  },
  dayChipSel: { backgroundColor: '#111', borderColor: '#111', },
  dayChipText: { color: '#333', fontWeight: '700', lineHeight: 15, fontSize: 13 },
  dayChipTextSel: { color: '#fff' },
  dayChipSub: { color: '#666', fontSize: 11, lineHeight: 13, marginTop: 2 },

  loading: { padding: 16, alignItems: 'center' },

  slotRow: {
    marginHorizontal: 16, marginTop: 10, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1
  },
  slotFree: { borderColor: '#cfead6', backgroundColor: '#f3fff6' },
  slotBusy: { borderColor: '#f1c7c7', backgroundColor: '#fff5f5' },
  slotPending: { borderColor: '#dedede', backgroundColor: '#f7f7f7' },

  slotTime: { fontSize: 16, fontWeight: '700' },
  slotTo: { color: '#999' },
  slotTimeEnd: { fontSize: 16, fontWeight: '600' },

  freeText: { marginTop: 4, color: '#2e7d32', fontWeight: '600' },
  busyText: { marginTop: 4, color: '#b71c1c', fontWeight: '600' },
  mineText: { marginTop: 4, color: '#1a237e', fontWeight: '700' },
  ownerPII: { marginTop: 4, color:'#111', fontWeight:'700' },

  acceptBtn: { backgroundColor:'#2e7d32', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, alignItems:'center', justifyContent:'center', marginRight: 8 },
  cancelBtn: { backgroundColor:'#111', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  cancelBtnText: { color:'#fff', fontWeight:'800', fontSize:16 },

  modalBackdrop: { flex:1, backgroundColor:'rgba(0,0,0,0.25)', alignItems:'center', justifyContent:'center', padding:16 },
  modalCard: { width:'100%', maxWidth:420, backgroundColor:'#fff', borderRadius:16, padding:16 },
  modalTitle: { fontSize:18, fontWeight:'700' },
  secondaryBtn: { paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#eaeaea' },
  secondaryBtnText: { color:'#333', fontWeight:'600' },
  dangerBtn: { paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#c62828' },
  dangerBtnText: { color:'#fff', fontWeight:'700' },
});
