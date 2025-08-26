import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HeaderBar from '../components/HeaderBar';
import { supabase } from '../lib/supabase';
import { Feather } from '@expo/vector-icons';
import ReserveModal from '../components/ReserveModal';
import { getOrCreateClientToken, getClientTokenOrNull } from '../lib/clientToken';

type SlotRow = {
  start_at: string;
  end_at: string;
  is_free: boolean;
  is_mine: boolean;
  mine_name: string | null;
  mine_phone: string | null;
  reservation_id: string | null;     // visible para dueño
  occupant_name: string | null;      // visible para dueño
  occupant_phone: string | null;     // visible para dueño
  occupant_status: 'pending' | 'accepted' | null;
};

type MyReservation = {
  id: string;
  start_at: string;
  end_at: string;
  status: 'pending' | 'accepted';
  customer_name: string | null;
  customer_phone: string | null;
};

type Props = {
  route: { params: { businessId: string; name?: string; style?: string | null } };
  navigation: any;
};

const WEEK = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];

// ---- utils fecha ----
function toYmd(d: Date) {
  const y = d.getFullYear(), m = `${d.getMonth() + 1}`.padStart(2, '0'), dd = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function stripTime(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeekSunday(d: Date) { return addDays(stripTime(d), -d.getDay()); }

function isoOrThrow(d: Date | string | undefined, field: string): string {
  if (!d) throw new Error(`${field} requerido`);
  const s = d instanceof Date ? d.toISOString() : String(d).trim();
  if (!s) throw new Error(`${field} vacío`);
  return s; // Debe ser ISO, p.ej. "2025-08-28T07:00:00.000Z"
}

function uuidOrThrow(id: string | undefined, field: string): string {
  const v = (id ?? '').trim();
  if (!v) throw new Error(`${field} requerido`);
  if (!/^[0-9a-f-]{36}$/i.test(v)) throw new Error(`${field} no es UUID válido`);
  return v;
}

export default function BusinessDetail({ route, navigation }: Props) {
  const { businessId, name } = route.params;
  const insets = useSafeAreaInsets();

  // rango navegable (hoy .. +60 días)
  const minDate = useMemo(() => stripTime(new Date()), []);
  const maxDate = useMemo(() => addDays(minDate, 60), [minDate]);

  const [loading, setLoading] = useState(true);
  const [nowTick, setNowTick] = useState(Date.now());
  const [loadingDay, setLoadingDay] = useState(false);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [dayClosed, setDayClosed] = useState<{ closed: boolean; message?: string }>({ closed: false });
  const [isOwner, setIsOwner] = useState(false);

  const [currentDate, setCurrentDate] = useState<Date>(minDate);
  const dateYmd = useMemo(() => toYmd(currentDate), [currentDate]);

  // banner "Tu cita"
  const [myReservation, setMyReservation] = useState<MyReservation | null>(null);
  const [myReservations, setMyReservations] = useState<MyReservation[]>([]);

  // modal de reserva
  const [reserveOpen, setReserveOpen] = useState(false);
  const [reserveSlot, setReserveSlot] = useState<{ start_at: string; end_at: string } | null>(null);

  // es dueño
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
        setIsOwner(!!data && (data as any).owner_user_id === uid);
      } else {
        setIsOwner(false);
      }
      setLoading(false);
    })();
  }, [businessId]);

  // cargar slots del día y cierre
  const reloadDay = useCallback(async () => {
    setLoadingDay(true);

    // vacaciones / cierre
    const { data: closure } = await supabase.rpc('get_day_closure', { p_business: businessId, p_date: dateYmd });
    if (closure && Array.isArray(closure) && (closure as any[])[0]) {
      const r = (closure as any[])[0] as any;
      setDayClosed({ closed: !!r.is_closed, message: r.message || undefined });
      if (r.is_closed) {
        setSlots([]);
        setLoadingDay(false);
        return;
      }
    } else setDayClosed({ closed: false });

    // token (si no existe, podemos crearlo para marcar is_mine correctamente)
    const token = await getClientTokenOrNull();

    const { data, error } = await supabase.rpc('get_day_slots', {
      p_business: businessId,
      p_date: dateYmd,
      p_client_token: token ?? null, // tu RPC acepta null
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

  useEffect(() => {
    const isToday = stripTime(currentDate).getTime() === stripTime(new Date()).getTime();
    if (!isToday) return;
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [currentDate]);
  useEffect(() => { if (!loading) reloadDay(); }, [loading, reloadDay]);
  useEffect(() => { if (!loading) reloadDay(); }, [dateYmd]);

  // Cancelar clientes cita X
  const cancelMineFromSlot = async (slot: SlotRow) => {
    try {
      if (!slot.reservation_id) return; // necesita el id (lo expone el backend arriba)
      const token = await getClientTokenOrNull();
      if (!token) return;
      const { data, error } = await supabase.rpc('cancel_reservation_by_token_json', {
        payload: { p_reservation: slot.reservation_id, p_client_token: token }
      });
      if (error || data !== true) {
        Alert.alert('Error', error?.message ?? 'No se pudo cancelar la reserva.');
        return;
      }
      // refresca UI
      await Promise.all([reloadDay(), reloadMyReservation()]);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo cancelar la reserva.');
    }
  };
  // cargar "mi cita" (persistente) — futuras
  const reloadMyReservation = useCallback(async () => {
    const token = await getClientTokenOrNull();
    if (!token) { setMyReservations([]); return; }

    const { data, error } = await supabase.rpc('get_my_reservations_for_business_json_v1', {
      payload: { p_business: businessId, p_client_token: token }
    });

    if (error) {
      console.warn('get_my_reservations_for_business_json_v1', error.message);
      setMyReservations([]);
      return;
    }

    const rows = Array.isArray(data) ? data as any[] : [];
    const mapped: MyReservation[] = rows.map(r => ({
      id: r.id,
      start_at: r.start_at,
      end_at: r.end_at,
      status: (r.status as 'pending' | 'accepted') ?? 'pending',
      customer_name: r.customer_name ?? null,
      customer_phone: r.customer_phone ?? null,
    }));

    // console.log('myReservations length', data?.length, data);

    // Oculta las que ya terminaron por si el backend devolviera alguna al límite
    setMyReservations(mapped);
  }, [businessId]);



  useEffect(() => { reloadMyReservation(); }, [businessId]);
  useEffect(() => {
    if (myReservation && new Date(myReservation.start_at).getTime() <= Date.now()) {
      setMyReservation(null);
    }
  }, [dateYmd, myReservation]);

  // navegación de fecha
  const canGoPrev = currentDate.getTime() > minDate.getTime();
  const canGoNext = currentDate.getTime() < maxDate.getTime();
  const goPrevDay = () => { if (canGoPrev) setCurrentDate(addDays(currentDate, -1)); };
  const goNextDay = () => { if (canGoNext) setCurrentDate(addDays(currentDate, +1)); };

  // chips semana
  const weekStart = useMemo(() => startOfWeekSunday(currentDate), [currentDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const onPickWeekday = (d: Date) => {
    const t = stripTime(d).getTime();
    if (t < minDate.getTime() || t > maxDate.getTime()) return;
    setCurrentDate(stripTime(d));
  };

  // dueño: aceptar / cancelar
  const ownerAccept = async (slot: SlotRow) => {
    if (!slot.reservation_id) return;
    const { error } = await supabase.rpc('owner_accept_reservation', { p_business: businessId, p_reservation: slot.reservation_id });
    if (error) { Alert.alert('No se pudo aceptar', error.message); return; }
    reloadDay();
  };
  const ownerCancel = async (slot: SlotRow) => {
    if (!slot.reservation_id) return;
    Alert.alert('Eliminar reserva', `¿Eliminar la reserva de ${slot.occupant_name ?? 'cliente'}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive', onPress: async () => {
          const { error } = await supabase.rpc('owner_cancel_reservation', { p_business: businessId, p_reservation: slot.reservation_id });
          if (error) { Alert.alert('Error', error.message); return; }
          reloadDay();
        }
      }
    ]);
  };

  // cliente: abrir modal sobre slot libre
  function isPastSlot(startIso: string) {
    // si la cita ya empezó, no permitimos reservar
    return new Date(startIso).getTime() <= Date.now();
  }
  const onPressFree = (slot: SlotRow) => {
    if (isPastSlot(slot.start_at)) return; // bloquea slots pasados
      setReserveSlot({ start_at: slot.start_at, end_at: slot.end_at });
      setReserveOpen(true);
  };

  // cliente: confirmar reserva desde la modal (DINÁMICO)
  const confirmReservation = async (form: { name: string; phone: string }) => {
    if (!reserveSlot) { Alert.alert('Error', 'No hay tramo seleccionado.'); return; }
    try {
      const token = await getOrCreateClientToken(); // string garantizado

      const payload = {
        p_business: uuidOrThrow(businessId, 'p_business'),
        p_client_token: (token ?? '').trim(),
        p_start_at: isoOrThrow(reserveSlot.start_at, 'p_start_at'),
        p_end_at:   isoOrThrow(reserveSlot.end_at,   'p_end_at'),
        p_name: (form?.name ?? '').trim(),
        p_phone: (form?.phone ?? '').trim(),
      };

      const { data, error } = await supabase.rpc('create_reservation_rpc_json_v1', { payload });

      if (error) {
        const msg = (error.message || '').toLowerCase();

        if (msg.includes('límite de reservas') || msg.includes('limite de reservas')) {
          Alert.alert('No se pudo reservar', 'Has alcanzado el límite de reservas de este establecimiento.');
          return;
        }
        if (msg.includes('solapa') || error.message === 'El horario seleccionado se solapa con otra reserva') {
          Alert.alert('No se pudo reservar', 'Ese tramo ya no está disponible.');
          return;
        }
        
        Alert.alert('No se pudo reservar', error.message || 'Inténtalo de nuevo.');
        return;
      }

      setReserveOpen(false);
      setReserveSlot(null);
      await Promise.all([reloadDay(), reloadMyReservation()]);
      Alert.alert('Reserva enviada', 'Tu reserva ha quedado pendiente de confirmación.');
    } catch (e: any) {
      console.warn('confirmReservation error', e);
      Alert.alert('Error', e?.message ?? 'No se pudo completar la reserva.');
    }
  };

  // cliente: cancelar su reserva (desde banner)
  const cancelMyReservation = async () => {
     if (!myReservation) return;
      const token = await getClientTokenOrNull();
      if (!token) return;

      const { data, error } = await supabase.rpc('cancel_reservation_by_token_json', {
        payload: { p_reservation: myReservation.id, p_client_token: token }
      });

      if (error || data !== true) {
        Alert.alert('Error', error?.message ?? 'No se pudo cancelar.');
        return;
      }
      setMyReservation(null);
      reloadDay();
  };

  // render slot
  const renderSlot = (s: SlotRow, idx: number) => {
    const t = new Date(s.start_at);
    const hh = `${t.getHours()}`.padStart(2, '0');
    const mm = `${t.getMinutes()}`.padStart(2, '0');
    const past = isPastSlot(s.start_at);

    let bg = '#e8f5e9', fg = '#1b5e20', label = 'Libre';
    let right: React.ReactNode = <Feather name="chevron-right" size={16} color={fg} />;

    if (s.is_free && past) {
      // libre pero ya pasado → deshabilitado
      bg = '#f5f5f5'; fg = '#9e9e9e'; label = 'Pasada';
      right = null;
    }

    if (!s.is_free) {
      if (s.occupant_status === 'pending') { bg = '#f0f0f0'; fg = '#555'; label = 'Pendiente'; }
      else { bg = '#ffebee'; fg = '#b71c1c'; label = 'Ocupada'; }
      right = null;

      if (isOwner) {
        if (s.occupant_status === 'pending') {
          right = (
            <View style={{ flexDirection: 'row' }}>
              <TouchableOpacity onPress={() => ownerAccept(s)} style={[styles.iconBtn, { backgroundColor: '#1b5e20', marginRight: 6 }]}>
                <Feather name="check" size={16} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => ownerCancel(s)} style={[styles.iconBtn, { backgroundColor: '#c62828' }]}>
                <Feather name="x" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          );
        } else if(s.is_mine){
          right = (
            <TouchableOpacity onPress={() => cancelMineFromSlot(s)} style={[styles.iconBtn, { backgroundColor: '#c62828' }]}>
              <Feather name="x" size={16} color="#fff" />
            </TouchableOpacity>
          );
        }
      }
    }

    const Content = (
      <View key={idx} style={[styles.slotRow, { backgroundColor: bg }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.slotHour, { color: fg }]}>{hh}:{mm}</Text>
          <Text style={[styles.slotSub, { color: fg }]}>{label}</Text>

          {!s.is_free && isOwner && (
            <Text style={{ color: fg, opacity: 0.9 }} numberOfLines={1} ellipsizeMode="tail">
              {s.occupant_name ?? ''}{s.occupant_phone ? (s.occupant_name ? ' • ' : '') + s.occupant_phone : ''}
            </Text>
          )}
          {!s.is_free && !isOwner && s.is_mine && (
            <Text style={{ color: fg, opacity: 0.9 }} numberOfLines={1} ellipsizeMode="tail">
              {s.mine_name ?? ''}{s.mine_phone ? (s.mine_name ? ' • ' : '') + s.mine_phone : ''}
            </Text>
          )}
        </View>
        {right}
      </View>
    );

    return s.is_free ? (
      <TouchableOpacity key={idx} activeOpacity={0.9} onPress={() => onPressFree(s)}>
        {Content}
      </TouchableOpacity>
    ) : Content;
  };

  const longDate = useMemo(
    () => currentDate.toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long' }),
    [currentDate]
  );

  const myDateText = useMemo(() => {
    if (!myReservation) return '';
    const d = new Date(myReservation.start_at);
    const datePart = d.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short' });
    const timePart = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    return `${datePart} · ${timePart}`;
  }, [myReservation]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <HeaderBar
        title={name ?? 'Detalle'}
        leftLabel="Volver"
        leftIcon="chevron-left"
        onLeftPress={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {/* Banner "Tus citas" (hasta 2 futuras) */}
        {myReservations.length > 0 && (
          <View style={styles.myBanner}>
            <View style={{ flex: 1 }}>
              <Text style={styles.myBannerTitle}>
                {myReservations.length === 1 ? 'Tu cita' : 'Tus próximas citas'}
              </Text>

              {myReservations.map((res, i) => {
                const d = new Date(res.start_at);
                const datePart = d.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short' });
                const timePart = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

                return (
                  <View key={res.id} style={{ marginTop: i === 0 ? 2 : 8, flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.myBannerLine}>{`${datePart} · ${timePart}`}</Text>
                      <Text style={[
                        styles.myBannerLine,
                        res.status === 'accepted' ? { color: '#1b5e20', fontWeight: '800' } : { color: '#b26a00', fontWeight: '800' }
                      ]}>
                        {res.status === 'accepted' ? 'Aceptada' : 'Pendiente'}
                      </Text>
                    </View>

                    <TouchableOpacity
                      onPress={async () => {
                        const token = await getClientTokenOrNull();
                        if (!token) return;
                        const { error } = await supabase.rpc('cancel_reservation_by_token_json', {
                          payload: { p_reservation: res.id, p_client_token: token }
                        });
                        if (error) {
                          Alert.alert('Error', error.message);
                          return;
                        }
                        // Quita solo esa
                        setMyReservations(prev => prev.filter(x => x.id !== res.id));
                        reloadDay();
                      }}
                      style={styles.myBannerBtn}
                    >
                      <Feather name="x" size={16} color="#fff" />
                      <Text style={styles.myBannerBtnText}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </View>
        )}


        {/* Selector card + flechas + fecha + chips semana */}
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

          <View style={styles.weekRow}>
            {weekDays.map((d, i) => {
              const sameDay = d.getTime() === stripTime(currentDate).getTime();
              const outOfRange = d.getTime() < minDate.getTime() || d.getTime() > maxDate.getTime();
              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => onPickWeekday(d)}
                  disabled={outOfRange}
                  style={[styles.dayChip, sameDay && styles.dayChipSel, outOfRange && styles.dayChipDisabled]}
                >
                  <Text style={[styles.dayChipText, sameDay && styles.dayChipTextSel, outOfRange && styles.dayChipTextDisabled]}>
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

      {/* Modal de reserva */}
      <ReserveModal
        visible={reserveOpen}
        onClose={() => { setReserveOpen(false); setReserveSlot(null); }}
        onConfirm={confirmReservation}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  // Banner "Tu cita"
  myBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#eef5ff', borderWidth: 1, borderColor: '#d6e4ff',
    borderRadius: 12, padding: 12, marginBottom: 14,
  },
  myBannerTitle: { fontWeight: '800', marginBottom: 2, color: '#113' },
  myBannerLine: { color: '#224', fontSize: 13 },
  myBannerBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#c62828', paddingVertical: 8, paddingHorizontal: 10,
    borderRadius: 10, marginLeft: 10,
  },
  myBannerBtnText: { color: '#fff', fontWeight: '700', marginLeft: 6 },

  // Selector (tu diseño)
  selectorCard: { backgroundColor: '#f7f7f7', borderRadius: 16, borderWidth: 1, borderColor: '#eee', padding: 12, marginBottom: 14 },
  selectorTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  roundBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee', width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  roundBtnDisabled: { opacity: 0.5 },
  selectorTitle: { fontWeight: '800', textTransform: 'capitalize' },
  selectorSub: { color: '#777', fontSize: 12 },

  weekRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayChip: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#efefef', borderRadius: 10 },
  dayChipSel: { backgroundColor: '#111' },
  dayChipDisabled: { opacity: 0.4 },
  dayChipText: { fontWeight: '800', color: '#333' },
  dayChipTextSel: { color: '#fff' },
  dayChipTextDisabled: { color: '#888' },

  // Lista de slots
  card: { backgroundColor: '#fafafa', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#eee', marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },

  slotRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 12, borderWidth: 1, borderColor: '#eee',
    paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10, minHeight: 64,
  },
  slotHour: { fontSize: 16, fontWeight: '800' },
  slotSub: { fontSize: 13, fontWeight: '700', opacity: 0.95, marginTop: 2, lineHeight: 18 },

  // Vacaciones
  closedBanner: { backgroundColor: '#ffeaea', borderColor: '#ffcccc', borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 14 },
  closedTitle: { fontWeight: '800', color: '#b71c1c' },
  closedMsg: { marginTop: 4, color: '#b71c1c' },

  // Botones dueño
  iconBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, minWidth: 36, alignItems: 'center' },
});
