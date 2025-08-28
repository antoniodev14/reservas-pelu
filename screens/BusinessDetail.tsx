import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  Alert,
  ImageBackground,
  Linking,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { Feather } from '@expo/vector-icons';
import ReserveModal from '../components/ReserveModal';
import { getOrCreateClientToken, getClientTokenOrNull } from '../lib/clientToken';

// ---- Tipos ----
type SlotRow = {
  start_at: string;
  end_at: string;
  is_free: boolean;
  is_mine: boolean;
  mine_name: string | null;
  mine_phone: string | null;
  reservation_id: string | null;  // solo dueño
  occupant_name: string | null;   // solo dueño
  occupant_phone: string | null;  // solo dueño
  occupant_status: 'pending' | 'accepted' | null; // solo dueño
};

type MyReservation = {
  id: string;
  start_at: string;
  end_at: string;
  status: 'pending' | 'accepted';
  customer_name: string | null;
  customer_phone: string | null;
};

type BusinessInfo = {
  id: string;
  name: string | null;
  banner_url: string | null;
  phone_public: string | null;
  lat: number | null;
  lon: number | null;
  address: string | null;
  owner_user_id: string | null;
  default_duration_minutes?: number | null;
};

type Props = {
  route: { params: { businessId: string; name?: string; style?: string | null } };
  navigation: any;
};

// ---- Helpers ----
function pad2(n: number) { return String(n).padStart(2, '0'); }
function toYmd(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function stripTime(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfWeekSunday(d: Date) { return addDays(stripTime(d), -d.getDay()); }
function isoOrThrow(d: Date | string | undefined, field: string): string {
  if (!d) throw new Error(`${field} requerido`);
  const s = d instanceof Date ? d.toISOString() : String(d).trim();
  if (!s) throw new Error(`${field} vacío`);
  return s;
}
function uuidOrThrow(id: string | undefined, field: string): string {
  const v = (id ?? '').trim();
  if (!v) throw new Error(`${field} requerido`);
  if (!/^[0-9a-f-]{36}$/i.test(v)) throw new Error(`${field} no es UUID válido`);
  return v;
}
function twoColumnChunks<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += 2) out.push(arr.slice(i, i + 2));
  return out;
}

const MAX_ACTIVE_RESERVATIONS = 2;

export default function BusinessDetail({ route, navigation }: Props) {
  const { businessId } = route.params;
  const insets = useSafeAreaInsets();

  const minDate = useMemo(() => stripTime(new Date()), []);
  const maxDate = useMemo(() => addDays(minDate, 60), [minDate]);

  const [loading, setLoading] = useState(true);
  const [loadingDay, setLoadingDay] = useState(false);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [biz, setBiz] = useState<BusinessInfo | null>(null);

  // cierre del día seleccionado (para el cuadro dentro de "Horarios")
  const [dayClosed, setDayClosed] = useState<{ closed: boolean; message?: string }>({ closed: false });

  const [currentDate, setCurrentDate] = useState<Date>(minDate);
  const dateYmd = useMemo(() => toYmd(currentDate), [currentDate]);

  // “mis citas”
  const [myReservations, setMyReservations] = useState<MyReservation[]>([]);

  // reserva (modal cliente)
  const [reserveOpen, setReserveOpen] = useState(false);
  const [reserveSlot, setReserveSlot] = useState<{ start_at: string; end_at: string } | null>(null);

  // modal dueño (info)
  const [ownerInfoOpen, setOwnerInfoOpen] = useState(false);
  const [ownerSlot, setOwnerSlot] = useState<SlotRow | null>(null);

  // modal cliente (info de su propia ocupada)
  const [clientInfoOpen, setClientInfoOpen] = useState(false);
  const [clientSlot, setClientSlot] = useState<SlotRow | null>(null);

  // cierres del mes para colorear calendario
  const [monthClosedDays, setMonthClosedDays] = useState<Record<string, { message?: string }>>({});

  // Header base + título
  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTransparent: true,
      headerShadowVisible: false,
      headerTintColor: '#fff',
      title: biz?.name ?? 'Detalle',
      headerTitle: undefined,
    });
  }, [navigation, biz?.name]);

  // Header dinámico (claro/oscuro) según scroll
  const [darkHeader, setDarkHeader] = useState(false);
  useEffect(() => {
    navigation.setOptions({
      headerTintColor: darkHeader ? '#111' : '#fff',
      headerShadowVisible: darkHeader,
      headerBackground: () => (
        <View style={{ flex: 1, backgroundColor: darkHeader ? 'rgba(255,255,255,0.95)' : 'transparent' }} />
      ),
    });
  }, [darkHeader, navigation]);

  const onScrollToggleHeader = useCallback((y: number, bannerHeight: number) => {
    const threshold = bannerHeight - (insets.top + 48);
    const shouldBeDark = y >= Math.max(0, threshold);
    setDarkHeader(prev => (prev !== shouldBeDark ? shouldBeDark : prev));
  }, [insets.top]);

  // Cargar negocio + dueño
  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id ?? null;

      const { data, error } = await supabase
        .from('businesses')
        .select('id,name,banner_url,phone_public,lat,lon,address,owner_user_id,default_duration_minutes')
        .eq('id', businessId)
        .maybeSingle();

      if (error) {
        Alert.alert('Error', error.message);
        return;
      }
      const b = (data as BusinessInfo) ?? null;
      setBiz(b);
      setIsOwner(!!uid && !!b && b.owner_user_id === uid);
      setLoading(false);
    })();
  }, [businessId]);

  // Slots del día + cierre del día
  const reloadDay = useCallback(async () => {
    setLoadingDay(true);

    // cierre del día seleccionado
    const { data: closure, error: cerrErr } = await supabase.rpc('get_day_closure', {
      p_business: businessId,
      p_date: dateYmd,
    });
    if (cerrErr) console.warn('get_day_closure', cerrErr.message);

    if (closure && Array.isArray(closure) && (closure as any[])[0]) {
      const r = (closure as any[])[0] as any;
      setDayClosed({ closed: !!r.is_closed, message: r.message || undefined });
      if (r.is_closed) {
        setSlots([]);
        setLoadingDay(false);
        return;
      }
    } else setDayClosed({ closed: false });

    // slots
    const token = await getClientTokenOrNull();
    const { data, error } = await supabase.rpc('get_day_slots_v2', {
      p_business: businessId,
      p_date: dateYmd,
      p_client_token: token ?? null,
    });
    if (error) {
      console.warn('get_day_slots_v2', error.message);
      Alert.alert('Error', 'No se pudieron cargar los horarios.');
      setSlots([]);
    } else {
      const rows = (data as any[]).map((r) => ({
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

  // Mis citas (cliente)
  useEffect(() => {
    (async () => {
      const token = await getClientTokenOrNull();
      if (!token) { setMyReservations([]); return; }
      const { data, error } = await supabase.rpc('get_my_reservations_for_business_json_v1', {
        payload: { p_business: businessId, p_client_token: token },
      });
      if (error) { console.warn('get_my_reservations_for_business_json_v1', error.message); setMyReservations([]); return; }
      const rows = Array.isArray(data) ? (data as any[]) : [];
      const mapped: MyReservation[] = rows.map((r) => ({
        id: r.id,
        start_at: r.start_at,
        end_at: r.end_at,
        status: (r.status as 'pending' | 'accepted') ?? 'pending',
        customer_name: r.customer_name ?? null,
        customer_phone: r.customer_phone ?? null,
      }));
      setMyReservations(mapped);
    })();
  }, [businessId]);

  // Cierres del mes visible (para colorear calendario)
  useEffect(() => {
    (async () => {
      const from = startOfMonth(currentDate);
      const to = endOfMonth(currentDate);
      try {
        const { data, error } = await supabase.rpc('get_closures_in_range', {
          p_business: businessId,
          p_from: toYmd(from),
          p_to: toYmd(to),
        });
        if (error) { console.warn('get_closures_in_range', error.message); setMonthClosedDays({}); return; }
        const map: Record<string, { message?: string }> = {};
        (data as any[]).forEach(row => { if (row.is_closed) map[row.day] = { message: row.message || undefined }; });
        setMonthClosedDays(map);
      } catch { setMonthClosedDays({}); }
    })();
  }, [businessId, currentDate]);

  // Acciones
  function isPastSlot(startIso: string) { return new Date(startIso).getTime() <= Date.now(); }

  const onPressFree = (slot: SlotRow) => {
    if (isOwner) return;
    if (isPastSlot(slot.start_at)) return;
    if (dayClosed.closed) return; // por si acaso
    if (myReservations.length >= MAX_ACTIVE_RESERVATIONS) { Alert.alert('Límite de reservas', 'Ya tienes 2 citas activas.'); return; }
    setReserveSlot({ start_at: slot.start_at, end_at: slot.end_at });
    setReserveOpen(true);
  };

  const onPressOccupiedOwner = (slot: SlotRow) => { if (!isOwner) return; setOwnerSlot(slot); setOwnerInfoOpen(true); };
  const onPressMineInfo = (slot: SlotRow) => { if (isOwner) return; if (!slot.is_free && slot.is_mine) { setClientSlot(slot); setClientInfoOpen(true); } };

  const ownerAccept = async (slot: SlotRow) => {
    if (!slot.reservation_id) return;
    await supabase.rpc('owner_accept_reservation', { p_business: businessId, p_reservation: slot.reservation_id });
    reloadDay();
    if (ownerInfoOpen) setOwnerSlot((s) => (s ? { ...s, occupant_status: 'accepted' } : s));
  };

  const ownerCancel = async (slot: SlotRow) => {
    if (!slot.reservation_id) return;
    Alert.alert(
      'Eliminar reserva',
      `¿Eliminar la reserva de ${slot.occupant_name ?? 'cliente'}${slot.occupant_phone ? ` (${slot.occupant_phone})` : ''}?`,
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
            if (error) {
              Alert.alert('Error', error.message);
              return;
            }
            await reloadDay();
            setOwnerInfoOpen(false);
            setOwnerSlot(null);
          },
        },
      ]
    );
  };

  const confirmReservation = async (form: { name: string; phone: string }, serviceId: string) => {
    if (!reserveSlot) { Alert.alert('Error', 'No hay tramo seleccionado.'); return; }
    try {
      const token = await getOrCreateClientToken();
      const payload = {
        p_business: uuidOrThrow(businessId, 'p_business'),
        p_client_token: (token ?? '').trim(),
        p_start_at: isoOrThrow(reserveSlot.start_at, 'p_start_at'),
        p_end_at: isoOrThrow(reserveSlot.end_at, 'p_end_at'),
        p_name: (form?.name ?? '').trim(),
        p_phone: (form?.phone ?? '').trim(),
        p_service_id: serviceId,
      };
      const { error } = await supabase.rpc('create_reservation_rpc_json_v2', { payload });
      if (error) { Alert.alert('Error', error.message || 'Inténtalo de nuevo.'); return; }
      setReserveOpen(false); setReserveSlot(null);
      await Promise.all([reloadDay()]);
      // refrescamos mis citas tras crear
      const tk = await getClientTokenOrNull();
      if (tk) {
        const { data } = await supabase.rpc('get_my_reservations_for_business_json_v1', { payload: { p_business: businessId, p_client_token: tk } });
        const rows = Array.isArray(data) ? (data as any[]) : [];
        setMyReservations(rows.map(r => ({
          id: r.id, start_at: r.start_at, end_at: r.end_at, status: (r.status as 'pending' | 'accepted') ?? 'pending',
          customer_name: r.customer_name ?? null, customer_phone: r.customer_phone ?? null,
        })));
      }
    } catch (e: any) { Alert.alert('Error', e?.message ?? 'No se pudo completar la reserva.'); }
  };

  const cancelReservationById = useCallback(async (resId: string) => {
    const token = await getClientTokenOrNull();
    if (!token) return;
    await supabase.rpc('cancel_reservation_by_token_json', { payload: { p_reservation: resId, p_client_token: token } });
    // refresh
    await Promise.all([reloadDay()]);
    const { data } = await supabase.rpc('get_my_reservations_for_business_json_v1', { payload: { p_business: businessId, p_client_token: token } });
    const rows = Array.isArray(data) ? (data as any[]) : [];
    setMyReservations(rows.map(r => ({
      id: r.id, start_at: r.start_at, end_at: r.end_at, status: (r.status as 'pending' | 'accepted') ?? 'pending',
      customer_name: r.customer_name ?? null, customer_phone: r.customer_phone ?? null,
    })));
  }, [businessId, reloadDay]);

  // Calendario (mes)
  const canGoPrev = currentDate.getTime() > minDate.getTime();
  const canGoNext = currentDate.getTime() < maxDate.getTime();
  const goPrevMonth = () => {
    const prev = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    if (endOfMonth(prev).getTime() < minDate.getTime()) return;
    setCurrentDate(stripTime(prev)); setReserveSlot(null);
  };
  const goNextMonth = () => {
    const next = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    if (startOfMonth(next).getTime() > maxDate.getTime()) return;
    setCurrentDate(stripTime(next)); setReserveSlot(null);
  };
  // inicio del mes actual
  const monthStart = useMemo(() => startOfMonth(currentDate), [currentDate]);
  const gridStart = useMemo(() => startOfWeekSunday(monthStart), [monthStart]);
  const gridDays = useMemo(() => {
    const daysInMonth = endOfMonth(currentDate).getDate();
    const startWeekday = monthStart.getDay(); // 0..6 (Do..Sa), empezamos en domingo
    const weeks = Math.ceil((startWeekday + daysInMonth) / 7); // 4, 5 o 6
    const totalCells = weeks * 7;
    return Array.from({ length: totalCells }, (_, i) => addDays(gridStart, i));
  }, [gridStart, currentDate]);

  const longMonth = useMemo(() => currentDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }), [currentDate]);

  // Slots visibles por rol (cliente no ve ocupadas ajenas)
  const visibleSlots = useMemo(() => (isOwner ? slots : slots.filter(s => s.is_free || s.is_mine)), [isOwner, slots]);

  // Top 2 citas en banner y altura dinámica
  const topReservations = useMemo(() => myReservations.slice(0, MAX_ACTIVE_RESERVATIONS), [myReservations]);
  const bannerHeight = useMemo(() => (topReservations.length > 1 ? 300 : 240), [topReservations.length]);

  // Helpers abrir enlaces
  async function safeOpenURL(url: string) {
    try {
      const can = await Linking.canOpenURL(url);
      if (can) await Linking.openURL(url);
    } catch {}
  }
  function openPhone(phone?: string | null) { if (!phone) return; safeOpenURL(`tel:${phone}`); }
  function openMaps(lat?: number | null, lon?: number | null, address?: string | null) {
    if (lat != null && lon != null) { safeOpenURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`); return; }
    if (address && address.trim()) { safeOpenURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`); }
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 16 }}
        onScroll={(e) => onScrollToggleHeader(e.nativeEvent.contentOffset.y, bannerHeight)}
        scrollEventThrottle={16}
      >
        {/* Banner */}
        <View style={styles.bannerWrap}>
          <ImageBackground
            source={biz?.banner_url ? { uri: biz.banner_url } : require('../assets/splash-icon.png')}
            resizeMode="cover"
            style={[styles.banner, { height: bannerHeight, paddingTop: insets.top + 40 }]}
          >
            <View style={styles.bannerOverlay} />

            {/* Botones centrados y a ancho con margen */}
            <View style={styles.bannerButtonsRow}>
              <TouchableOpacity onPress={() => openPhone(biz?.phone_public)} style={[styles.bannerBtn, { backgroundColor: '#111' }]}>
                <Feather name="phone" size={16} color="#fff" />
                <Text style={styles.bannerBtnText}>Contacto</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openMaps(biz?.lat, biz?.lon, biz?.address)} style={[styles.bannerBtn, { backgroundColor: '#0a6' }]}>
                <Feather name="map-pin" size={16} color="#fff" />
                <Text style={styles.bannerBtnText}>Dónde estamos</Text>
              </TouchableOpacity>
            </View>

            {/* Citas en banner (máx 2) */}
            {topReservations.length > 0 && (
              <View style={styles.bannerSelection}>
                {/* Header: icono + título en la misma línea */}
                <View style={styles.bannerSelHeader}>
                  <Feather name="calendar" size={16} color="#fff" />
                  <Text style={styles.selTitle}>
                    {topReservations.length === 1 ? 'Tu próxima cita' : 'Tus próximas citas'}
                  </Text>
                </View>

                {/* Lista (máx 2) */}
                {topReservations.map((res) => (
                  <View key={res.id} style={styles.bannerResRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.selSub}>
                        {new Date(res.start_at).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short' })}{' '}
                        · {new Date(res.start_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                        {' — '}
                        {new Date(res.end_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                        {' · '}
                        {res.status === 'accepted' ? 'Aceptada' : 'Pendiente'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => cancelReservationById(res.id)}
                      style={[styles.selBtn, { backgroundColor: '#c62828', marginLeft: 8 }]}
                    >
                      <Text style={styles.selBtnText}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

          </ImageBackground>
        </View>

        {/* Calendario mensual con días cerrados marcados */}
        <View style={[styles.selectorCard, { marginHorizontal: 16 }]}>
          <View style={styles.selectorTopRow}>
            <TouchableOpacity onPress={goPrevMonth} disabled={!canGoPrev} style={[styles.roundBtn, !canGoPrev && styles.roundBtnDisabled]}>
              <Feather name="chevron-left" size={18} color={canGoPrev ? '#111' : '#bbb'} />
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.selectorTitle}>{longMonth}</Text>
              <Text style={styles.selectorSub}>{toYmd(currentDate)}</Text>
            </View>
            <TouchableOpacity onPress={goNextMonth} disabled={!canGoNext} style={[styles.roundBtn, !canGoNext && styles.roundBtnDisabled]}>
              <Feather name="chevron-right" size={18} color={canGoNext ? '#111' : '#bbb'} />
            </TouchableOpacity>
          </View>

          <View style={styles.calendarWeekHeader}>
            {['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'].map((d) => (
              <Text key={d} style={styles.calendarWeekHeaderText}>{d}</Text>
            ))}
          </View>

          <View style={styles.calendarGrid}>
            {gridDays.map((d, i) => {
              const t = stripTime(d).getTime();
              const outOfMonth = d.getMonth() !== currentDate.getMonth();
              const outOfRange = t < minDate.getTime() || t > maxDate.getTime();
              const isSelected = t === stripTime(currentDate).getTime();
              const ymd = toYmd(d);
              const isClosedDay = !!monthClosedDays[ymd];

              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => {
                    if (outOfRange) return;
                    setCurrentDate(stripTime(d));
                    setReserveSlot(null);
                  }}
                  disabled={outOfRange}
                  style={[
                    styles.calendarCell,
                    outOfMonth && styles.calendarCellOutMonth,
                    isSelected && styles.calendarCellSelected,
                    outOfRange && styles.calendarCellDisabled,
                    isClosedDay && styles.calendarCellClosed,
                  ]}
                >
                  <Text
                    style={[
                      styles.calendarCellText,
                      outOfMonth && styles.calendarCellTextOutMonth,
                      isSelected && styles.calendarCellTextSelected,
                      outOfRange && styles.calendarCellTextDisabled,
                    ]}
                  >
                    {d.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Horarios */}
        <View style={[styles.card, { marginHorizontal: 16 }]}>
          <Text style={styles.cardTitle}>Horarios</Text>

          {dayClosed.closed ? (
            <View style={styles.closedBanner}>
              <Text style={styles.closedTitle}>Cerrado por vacaciones</Text>
              {!!dayClosed.message && <Text style={styles.closedMsg}>{dayClosed.message}</Text>}
            </View>
          ) : loadingDay ? (
            <View style={{ paddingVertical: 10 }}><ActivityIndicator /></View>
          ) : visibleSlots.length === 0 ? (
            <Text style={{ color: '#666' }}>No hay horarios para este día.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {twoColumnChunks(visibleSlots).map((pair, rowIdx) => (
                <View key={rowIdx} style={styles.slotRow2}>
                  {pair.map((s, colIdx) => {
                    const t = new Date(s.start_at);
                    const hh = pad2(t.getHours());
                    const mm = pad2(t.getMinutes());
                    const past = isPastSlot(s.start_at);

                    let bg = '#e8f5e9', fg = '#1b5e20', label = 'Libre';
                    let right: React.ReactNode = <Feather name="chevron-right" size={16} color={fg} />;

                    if (s.is_free && past) { bg = '#f5f5f5'; fg = '#9e9e9e'; label = 'Pasada'; right = null; }
                    if (!s.is_free) {
                      bg = '#ffebee'; fg = '#b71c1c'; label = 'Ocupada';
                      if (isOwner || (!isOwner && s.is_mine)) right = <Feather name="info" size={16} color={fg} />; else right = null;
                    }

                    const CellContent = (
                      <View style={[styles.slotCell, { backgroundColor: bg }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.slotHour, { color: fg }]}>{hh}:{mm}</Text>
                          <Text style={[styles.slotSub, { color: fg }]}>{label}</Text>
                        </View>
                        {right}
                      </View>
                    );

                    const key = `${rowIdx}-${colIdx}`;

                    if (isOwner) {
                      return s.is_free ? (
                        <View key={key} style={{ flex: 1, opacity: past ? 0.6 : 1 }}>{CellContent}</View>
                      ) : (
                        <TouchableOpacity key={key} activeOpacity={0.9} onPress={() => onPressOccupiedOwner(s)} style={{ flex: 1 }}>
                          {CellContent}
                        </TouchableOpacity>
                      );
                    } else {
                      if (s.is_free) {
                        return (
                          <TouchableOpacity key={key} activeOpacity={0.9} onPress={() => onPressFree(s)} style={{ flex: 1 }}>
                            {CellContent}
                          </TouchableOpacity>
                        );
                      } else if (s.is_mine) {
                        return (
                          <TouchableOpacity key={key} activeOpacity={0.9} onPress={() => onPressMineInfo(s)} style={{ flex: 1 }}>
                            {CellContent}
                          </TouchableOpacity>
                        );
                      } else {
                        return <View key={key} style={{ flex: 1 }}>{CellContent}</View>;
                      }
                    }
                  })}
                  {pair.length === 1 && <View style={{ flex: 1 }} />}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Modal reserva (cliente) */}
      <ReserveModal
        visible={reserveOpen}
        businessId={businessId}                 // ← añade esto
        onClose={() => setReserveOpen(false)}
        onConfirm={(form, serviceId) => confirmReservation(form, serviceId)}  // ← ahora recibe serviceId
      />

      {/* Modal dueño */}
      <Modal visible={ownerInfoOpen} transparent animationType="fade" onRequestClose={() => setOwnerInfoOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Detalle de la cita</Text>
            {ownerSlot ? (
              <>
                <Text style={styles.modalLine}>
                  Hora: {new Date(ownerSlot.start_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} - {new Date(ownerSlot.end_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                </Text>
                <Text style={styles.modalLine}>Estado: {ownerSlot.occupant_status === 'accepted' ? 'Aceptada' : 'Pendiente'}</Text>
                <Text style={styles.modalLine}>Nombre: {ownerSlot.occupant_name ?? '—'}</Text>
                <Text style={styles.modalLine}>Teléfono: {ownerSlot.occupant_phone ?? '—'}</Text>

                <View style={{ flexDirection: 'row', marginTop: 12, flexWrap: 'wrap' }}>
                  {/* Llamar si hay teléfono */}
                  {ownerSlot.occupant_phone ? (
                    <TouchableOpacity
                      onPress={() => openPhone(ownerSlot.occupant_phone!)}
                      style={[styles.modalBtn, { backgroundColor: '#111', marginRight: 8, marginBottom: 8 }]}
                    >
                      <Feather name="phone" size={16} color="#fff" />
                      <Text style={styles.modalBtnText}>Llamar</Text>
                    </TouchableOpacity>
                  ) : null}

                  {/* Aceptar si está pendiente */}
                  {ownerSlot.occupant_status === 'pending' ? (
                    <TouchableOpacity
                      onPress={() => ownerAccept(ownerSlot)}
                      style={[styles.modalBtn, { backgroundColor: '#1b5e20', marginRight: 8, marginBottom: 8 }]}
                    >
                      <Feather name="check" size={16} color="#fff" />
                      <Text style={styles.modalBtnText}>Aceptar</Text>
                    </TouchableOpacity>
                  ) : null}

                  {/* Eliminar siempre disponible */}
                  <TouchableOpacity
                    onPress={() => ownerCancel(ownerSlot)}
                    style={[styles.modalBtn, { backgroundColor: '#c62828', marginBottom: 8 }]}
                  >
                    <Feather name="trash-2" size={16} color="#fff" />
                    <Text style={styles.modalBtnText}>Eliminar</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : <Text style={{ color: '#333' }}>No hay datos.</Text>}
            <TouchableOpacity onPress={() => setOwnerInfoOpen(false)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal cliente */}
      <Modal visible={clientInfoOpen} transparent animationType="fade" onRequestClose={() => setClientInfoOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Tu cita</Text>
            {clientSlot ? (
              <>
                <Text style={styles.modalLine}>
                  Fecha: {new Date(clientSlot.start_at).toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long' })}
                </Text>
                <Text style={styles.modalLine}>
                  Hora: {new Date(clientSlot.start_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} - {new Date(clientSlot.end_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </>
            ) : <Text style={{ color: '#333' }}>No hay datos.</Text>}
            <TouchableOpacity onPress={() => setClientInfoOpen(false)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:{ flex:1, backgroundColor:'#fff' },

  // Banner
  bannerWrap:{ marginBottom:14 },
  banner:{ width:'100%' },
  bannerOverlay:{ ...StyleSheet.absoluteFillObject, backgroundColor:'rgba(0,0,0,0.30)' },

  // Botones banner centrados y a ancho
  bannerButtonsRow:{ position:'absolute', left:16, right:16, bottom:14, flexDirection:'row' },
  bannerBtn:{ flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', paddingVertical:12, borderRadius:12, marginHorizontal:4 },
  bannerBtnText:{ color:'#fff', fontWeight:'800', marginLeft:8 },

  // Overlay reservas en banner
  bannerSelection: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 64,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    padding: 10,
  },
  bannerSelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,          // separa header de la lista
  },
  selTitle: { color: '#fff', fontWeight: '900', marginLeft: 8 },
  bannerResRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  selSub: { color: '#fff', opacity: 0.95, fontSize: 13 },
  selBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  selBtnText: { color: '#fff', fontWeight: '800' },

  // Calendario compacto
  selectorCard:{ backgroundColor:'#f7f7f7', borderRadius:14, borderWidth:1, borderColor:'#eee', paddingVertical:8, paddingHorizontal:10, marginBottom:10 },
  selectorTopRow:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:6 },
  roundBtn:{ backgroundColor:'#fff', borderWidth:1, borderColor:'#eee', width:36, height:36, borderRadius:10, alignItems:'center', justifyContent:'center' },
  roundBtnDisabled:{ opacity:0.5 },
  selectorTitle:{ fontWeight:'800', textTransform:'capitalize' },
  selectorSub:{ color:'#777', fontSize:12 },

  calendarWeekHeader:{ flexDirection:'row', justifyContent:'space-between', paddingHorizontal:4, marginBottom:2 },
  calendarWeekHeaderText:{ width: `${100/7}%`, textAlign:'center', fontWeight:'800', color:'#333' },

  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'flex-start',   // importante para que no “estire”
  },
  calendarCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1.0,             // compáctalo si quieres: 0.95
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    marginVertical: 2,            // pon 0 si aún lo ves alto
  },
  calendarCellOutMonth:{ opacity:0.6 },
  calendarCellSelected:{ backgroundColor:'#111' },
  calendarCellDisabled:{ opacity:0.25 },
  calendarCellText:{ fontWeight:'800', color:'#333' },
  calendarCellTextOutMonth:{ color:'#666' },
  calendarCellTextSelected:{ color:'#fff' },
  calendarCellTextDisabled:{ color:'#777' },

  // Cerrados (mes)
  calendarCellClosed:{ borderWidth:1, borderColor:'#ffcccc', backgroundColor:'rgba(255,0,0,0.05)' },

  // Lista de slots
  card:{ backgroundColor:'#fafafa', borderRadius:14, padding:16, borderWidth:1, borderColor:'#eee', marginBottom:14 },
  cardTitle:{ fontSize:16, fontWeight:'800', marginBottom:8 },
  slotRow2:{ flexDirection:'row', gap:10 },
  slotCell:{ flex:1, flexDirection:'row', alignItems:'center', justifyContent:'space-between', borderRadius:12, borderWidth:1, borderColor:'#eee', paddingVertical:12, paddingHorizontal:14, minHeight:64 },
  slotHour:{ fontSize:16, fontWeight:'800' },
  slotSub:{ fontSize:13, fontWeight:'700', opacity:0.95, marginTop:2 },

  // Vacaciones (card de Horarios)
  closedBanner:{ backgroundColor:'#ffeaea', borderColor:'#ffcccc', borderWidth:1, borderRadius:10, padding:12 },
  closedTitle:{ fontWeight:'800', color:'#b71c1c' },
  closedMsg:{ marginTop:4, color:'#b71c1c' },

  // Modales
  modalBackdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', alignItems:'center', justifyContent:'center', padding:16 },
  modalCard:{ backgroundColor:'#fff', borderRadius:14, padding:16, borderWidth:1, borderColor:'#eee', width:'100%' },
  modalTitle:{ fontSize:16, fontWeight:'900', marginBottom:8, color:'#111' },
  modalLine:{ color:'#222', marginTop:6 },
  modalLabel:{ fontWeight:'800', color:'#111' },
  modalBtn:{ flexDirection:'row', alignItems:'center', paddingVertical:8, paddingHorizontal:10, borderRadius:10 },
  modalBtnText:{ color:'#fff', fontWeight:'800', marginLeft:6 },
  modalClose:{ marginTop:14, alignSelf:'flex-end', paddingVertical:8, paddingHorizontal:10 },
  modalCloseText:{ fontWeight:'800', color:'#111' },
});
