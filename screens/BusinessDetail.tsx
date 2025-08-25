import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HeaderBar from '../components/HeaderBar';
import { supabase } from '../lib/supabase';
import { Feather } from '@expo/vector-icons';

type SlotRow = {
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

type Props = {
  route: { params: { businessId: string; name?: string; style?: string | null } };
  navigation: any;
};

const WEEK = ['Do','Lu','Ma','Mi','Ju','Vi','Sa'];

// utilidades fecha
function toYmd(d: Date) {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function stripTime(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeekSunday(d: Date) {
  const wd = d.getDay(); // 0..6
  return addDays(stripTime(d), -wd);
}

export default function BusinessDetail({ route, navigation }: Props) {
  const { businessId, name, style: hairStyle } = route.params;
  const insets = useSafeAreaInsets();

  // ------ rango navegable (hoy .. hoy + 60) ------
  const minDate = useMemo(() => stripTime(new Date()), []);
  const maxDate = useMemo(() => addDays(minDate, 60), [minDate]);

  const [loading, setLoading] = useState(true);
  const [loadingDay, setLoadingDay] = useState(false);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [dayClosed, setDayClosed] = useState<{ closed: boolean; message?: string }>({ closed: false });
  const [isOwner, setIsOwner] = useState(false);

  const [currentDate, setCurrentDate] = useState<Date>(minDate);
  const dateYmd = useMemo(() => toYmd(currentDate), [currentDate]);

  // estado de dueño
  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id ?? null;
      if (uid) {
        const { data } = await supabase
          .from('businesses')
          .select('owner_user_id')
          .eq('id', businessId)
          .maybeSingle();
        setIsOwner(!!data && data.owner_user_id === uid);
      } else {
        setIsOwner(false);
      }
      setLoading(false);
    })();
  }, [businessId]);

  // cargar info del día
  const reloadDay = useCallback(async () => {
    setLoadingDay(true);

    // vacaciones
    const { data: closure } = await supabase.rpc('get_day_closure', {
      p_business: businessId,
      p_date: dateYmd,
    });
    if (closure && Array.isArray(closure) && closure[0]) {
      const r = closure[0] as any;
      setDayClosed({ closed: !!r.is_closed, message: r.message || undefined });
      if (r.is_closed) {
        setSlots([]);
        setLoadingDay(false);
        return;
      }
    } else {
      setDayClosed({ closed: false });
    }

    // slots
    const { data, error } = await supabase.rpc('get_day_slots', {
      p_business: businessId,
      p_date: dateYmd,
      p_client_token: null, // si usas token anónimo, pásalo aquí
    });
    if (error) {
      console.warn('get_day_slots', error.message);
      Alert.alert('Error', 'No se pudieron cargar los horarios.');
      setSlots([]);
    } else {
      const rows = (data as any[]).map(r => ({
        start_at: r.start_at,
        end_at: r.end_at,
        is_free: !!r.is_free,
        is_mine: !!r.is_mine,
        mine_name: r.mine_name ?? null,
        mine_phone: r.mine_phone ?? null,
        reservation_id: r.reservation_id ?? null,
        occupant_name: r.occupant_name ?? null,
        occupant_phone: r.occupant_phone ?? null,
        occupant_status: r.occupant_status ?? null,
      })) as SlotRow[];
      setSlots(rows);
    }
    setLoadingDay(false);
  }, [businessId, dateYmd]);

  useEffect(() => { if (!loading) reloadDay(); }, [loading, reloadDay]);
  useEffect(() => { if (!loading) reloadDay(); }, [dateYmd]);

  // navegación de fecha (flechas)
  const canGoPrev = currentDate.getTime() > minDate.getTime();
  const canGoNext = currentDate.getTime() < maxDate.getTime();

  const goPrevDay = () => { if (canGoPrev) setCurrentDate(addDays(currentDate, -1)); };
  const goNextDay = () => { if (canGoNext) setCurrentDate(addDays(currentDate, +1)); };

  // chips de la semana del currentDate
  const weekStart = useMemo(() => startOfWeekSunday(currentDate), [currentDate]);
  const weekDays = useMemo(() => {
    // 0..6 desde el domingo del currentDate
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const onPickWeekday = (d: Date) => {
    // respetar límites
    const t = stripTime(d).getTime();
    if (t < minDate.getTime() || t > maxDate.getTime()) return;
    setCurrentDate(stripTime(d));
  };

  // acciones del dueño
  const ownerAccept = async (slot: SlotRow) => {
    if (!slot.reservation_id) return;
    const { error } = await supabase.rpc('owner_accept_reservation', {
      p_business: businessId,
      p_reservation: slot.reservation_id,
    });
    if (error) {
      Alert.alert('No se pudo aceptar', error.message);
      return;
    }
    reloadDay();
  };

  const ownerCancel = async (slot: SlotRow) => {
    if (!slot.reservation_id) return;
    Alert.alert(
      'Eliminar reserva',
      `¿Eliminar la reserva de ${slot.occupant_name ?? 'cliente'}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('owner_cancel_reservation', {
              p_business: businessId,
              p_reservation: slot.reservation_id,
            });
            if (error) { Alert.alert('Error', error.message); return; }
            reloadDay();
          },
        },
      ]
    );
  };

  // render de un slot
  const renderSlot = (s: SlotRow, idx: number) => {
    const t = new Date(s.start_at);
    const hh = `${t.getHours()}`.padStart(2, '0');
    const mm = `${t.getMinutes()}`.padStart(2, '0');

    let bg = '#e8f5e9'; // libre → verde claro
    let fg = '#1b5e20';
    let right: React.ReactNode = <Feather name="chevron-right" size={16} color={fg} />;

    if (!s.is_free) {
      if (s.occupant_status === 'pending') {
        bg = '#f0f0f0'; fg = '#555';
      } else {
        bg = '#ffebee'; fg = '#b71c1c';
      }
      right = null;

      if (isOwner) {
        if (s.occupant_status === 'pending') {
          right = (
            <View style={{ flexDirection: 'row' }}>
              <TouchableOpacity
                onPress={() => ownerAccept(s)}
                style={[styles.iconBtn, { backgroundColor: '#1b5e20', marginRight: 6 }]}
              >
                <Feather name="check" size={16} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => ownerCancel(s)}
                style={[styles.iconBtn, { backgroundColor: '#c62828' }]}
              >
                <Feather name="x" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          );
        } else {
          right = (
            <TouchableOpacity
              onPress={() => ownerCancel(s)}
              style={[styles.iconBtn, { backgroundColor: '#c62828' }]}
            >
              <Feather name="x" size={16} color="#fff" />
            </TouchableOpacity>
          );
        }
      }
    }

    return (
      <View key={idx} style={[styles.slotRow, { backgroundColor: bg }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.slotHour, { color: fg }]}>{hh}:{mm}</Text>
          {!s.is_free && isOwner && (
            <Text style={{ color: fg, opacity: 0.9 }}>
              {s.occupant_name ?? ''}{s.occupant_phone ? (s.occupant_name ? ' • ' : '') + s.occupant_phone : ''}
            </Text>
          )}
          {!s.is_free && !isOwner && s.is_mine && (
            <Text style={{ color: fg, opacity: 0.9 }}>
              {s.mine_name ?? ''}{s.mine_phone ? (s.mine_name ? ' • ' : '') + s.mine_phone : ''}
            </Text>
          )}
        </View>
        {right}
      </View>
    );
  };

  // fecha centrada (como en tu captura)
  const longDate = useMemo(() =>
    currentDate.toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long' }),
    [currentDate]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <HeaderBar
        title={name ?? 'Detalle'}
        leftLabel="Volver"
        leftIcon="chevron-left"
        onLeftPress={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {/* SELECTOR estilo captura: card + flechas + fecha + chips de semana */}
        <View style={styles.selectorCard}>
          <View style={styles.selectorTopRow}>
            <TouchableOpacity onPress={goPrevDay} disabled={!canGoPrev} style={[styles.roundBtn, !canGoPrev && styles.roundBtnDisabled]}>
              <Feather name="chevron-left" size={18} color={canGoPrev ? '#111' : '#bbb'} />
            </TouchableOpacity>

            <View style={{ alignItems: 'center' }}>
              <Text style={styles.selectorTitle}>{longDate}</Text>
              <Text style={styles.selectorSub}>{dateYmd}</Text>
            </View>

            <TouchableOpacity onPress={goNextDay} disabled={!canGoNext} style={[styles.roundBtn, !canGoNext && styles.roundBtnDisabled]}>
              <Feather name="chevron-right" size={18} color={canGoNext ? '#111' : '#bbb'} />
            </TouchableOpacity>
          </View>

          {/* Chips de la semana del día actual */}
          <View style={styles.weekRow}>
            {weekDays.map((d, i) => {
              const sameDay = d.getTime() === stripTime(currentDate).getTime();
              const outOfRange = d.getTime() < minDate.getTime() || d.getTime() > maxDate.getTime();
              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => onPickWeekday(d)}
                  disabled={outOfRange}
                  style={[
                    styles.dayChip,
                    sameDay && styles.dayChipSel,
                    outOfRange && styles.dayChipDisabled,
                  ]}
                >
                  <Text style={[
                    styles.dayChipText,
                    sameDay && styles.dayChipTextSel,
                    outOfRange && styles.dayChipTextDisabled,
                  ]}>
                    {WEEK[d.getDay()]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Banner de vacaciones */}
        {dayClosed.closed && (
          <View style={styles.closedBanner}>
            <Text style={styles.closedTitle}>Cerrado por vacaciones</Text>
            {!!dayClosed.message && <Text style={styles.closedMsg}>{dayClosed.message}</Text>}
          </View>
        )}

        {/* Lista de horas */}
        {!dayClosed.closed && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Horarios</Text>
            {loadingDay ? (
              <View style={{ paddingVertical: 10 }}><ActivityIndicator /></View>
            ) : slots.length === 0 ? (
              <Text style={{ color: '#666' }}>No hay horarios para este día.</Text>
            ) : (
              <View>{slots.map(renderSlot)}</View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  // --- Selector card (como en tu captura) ---
  selectorCard: {
    backgroundColor: '#f7f7f7',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#eee',
    padding: 12,
    marginBottom: 14,
  },
  selectorTopRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  roundBtn: {
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#eee',
    width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
  roundBtnDisabled: { opacity: 0.5 },
  selectorTitle: { fontWeight: '800', textTransform: 'capitalize' },
  selectorSub: { color: '#777', fontSize: 12 },

  weekRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  dayChip: {
    paddingVertical: 6, paddingHorizontal: 12,
    backgroundColor: '#efefef', borderRadius: 10,
  },
  dayChipSel: { backgroundColor: '#111' },
  dayChipDisabled: { opacity: 0.4 },
  dayChipText: { fontWeight: '800', color: '#333' },
  dayChipTextSel: { color: '#fff' },
  dayChipTextDisabled: { color: '#888' },

  // --- Cards y lista de slots ---
  card: { backgroundColor: '#fafafa', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#eee', marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },

  slotRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 10, borderWidth: 1, borderColor: '#eee', paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8,
  },
  slotHour: { fontSize: 16, fontWeight: '800' },

  // --- Vacaciones banner ---
  closedBanner: { backgroundColor: '#ffeaea', borderColor: '#ffcccc', borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 14 },
  closedTitle: { fontWeight: '800', color: '#b71c1c' },
  closedMsg: { marginTop: 4, color: '#b71c1c' },

  // --- Botones dueño ---
  iconBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
});
