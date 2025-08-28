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
  Platform,
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
  reservation_id: string | null; // visible para dueño
  occupant_name: string | null;  // visible para dueño
  occupant_phone: string | null; // visible para dueño
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
  route: {
    params: {
      businessId: string;
      name?: string;
      style?: string | null;
    };
  };
  navigation: any;
};

// ---- utils fecha ----
function pad2(n: number) {
  return String(n).padStart(2, '0');
}
function toYmd(d: Date) {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
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
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function startOfWeekSunday(d: Date) {
  return addDays(stripTime(d), -d.getDay());
}
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

type BusinessInfo = {
  id: string;
  name: string | null;
  banner_url: string | null;
  phone_public: string | null;
  lat: number | null;
  lon: number | null; // <— lon corregido
  address: string | null;
  owner_user_id: string | null;
  default_duration_minutes?: number | null; // opcional si lo quieres leer en front
};

export default function BusinessDetail({ route, navigation }: Props) {
  const { businessId, name: nameFromRoute } = route.params;
  const insets = useSafeAreaInsets();

  // rango navegable (hoy .. +60 días)
  const minDate = useMemo(() => stripTime(new Date()), []);
  const maxDate = useMemo(() => addDays(minDate, 60), [minDate]);

  const [loading, setLoading] = useState(true);
  const [loadingDay, setLoadingDay] = useState(false);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [dayClosed, setDayClosed] = useState<{ closed: boolean; message?: string }>({ closed: false });
  const [isOwner, setIsOwner] = useState(false);
  const [biz, setBiz] = useState<BusinessInfo | null>(null);

  const [currentDate, setCurrentDate] = useState<Date>(minDate);
  const dateYmd = useMemo(() => toYmd(currentDate), [currentDate]);

  // banner "Tus citas"
  const [myReservations, setMyReservations] = useState<MyReservation[]>([]);

  // selección de slot (para integrarlo en el banner)
  const [reserveOpen, setReserveOpen] = useState(false);
  const [reserveSlot, setReserveSlot] = useState<{ start_at: string; end_at: string } | null>(null);

  // cargar negocio + check dueño
  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id ?? null;

      const { data: bdata, error: bErr } = await supabase
        .from('businesses')
        .select('id,name,banner_url,phone_public,lat,lon,address,owner_user_id,default_duration_minutes')
        .eq('id', businessId)
        .maybeSingle();

      if (bErr) {
        Alert.alert('Error', bErr.message);
      }
      const b = (bdata as BusinessInfo) ?? null;
      setBiz(b);
      setIsOwner(!!uid && !!b && b.owner_user_id === uid);
      setLoading(false);
    })();
  }, [businessId]);

  // cargar slots del día y cierre
  const reloadDay = useCallback(async () => {
    setLoadingDay(true);

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
    } else {
      setDayClosed({ closed: false });
    }

    const token = await getClientTokenOrNull();
    const { data, error } = await supabase.rpc('get_day_slots_v1', {
      p_business: businessId,
      p_date: dateYmd,
      p_client_token: token ?? null,
    });

    if (error) {
      console.warn('get_day_slots_v1', error.message);
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

  useEffect(() => {
    if (!loading) reloadDay();
  }, [loading, reloadDay]);

  useEffect(() => {
    if (!loading) reloadDay();
  }, [dateYmd]);

  // cargar "mis citas" (futuras)
  const reloadMyReservation = useCallback(async () => {
    const token = await getClientTokenOrNull();
    if (!token) {
      setMyReservations([]);
      return;
    }
    const { data, error } = await supabase.rpc('get_my_reservations_for_business_json_v1', {
      payload: { p_business: businessId, p_client_token: token },
    });
    if (error) {
      console.warn('get_my_reservations_for_business_json_v1', error.message);
      setMyReservations([]);
      return;
    }
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
  }, [businessId]);

  useEffect(() => {
    reloadMyReservation();
  }, [businessId]);

  // dueño: aceptar / cancelar
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
            if (error) {
              Alert.alert('Error', error.message);
              return;
            }
            reloadDay();
          },
        },
      ]
    );
  };

  // cliente: abrir modal sobre slot libre
  function isPastSlot(startIso: string) {
    return new Date(startIso).getTime() <= Date.now();
  }
  const onPressFree = (slot: SlotRow) => {
    if (isPastSlot(slot.start_at)) return;
    setReserveSlot({ start_at: slot.start_at, end_at: slot.end_at }); // mostrar en banner
    setReserveOpen(true); // seguir usando la modal de confirmación
  };

  // cliente: confirmar reserva
  const confirmReservation = async (form: { name: string; phone: string }) => {
    if (!reserveSlot) {
      Alert.alert('Error', 'No hay tramo seleccionado.');
      return;
    }
    try {
      const token = await getOrCreateClientToken();
      const payload = {
        p_business: uuidOrThrow(businessId, 'p_business'),
        p_client_token: (token ?? '').trim(),
        p_start_at: isoOrThrow(reserveSlot.start_at, 'p_start_at'),
        p_end_at: isoOrThrow(reserveSlot.end_at, 'p_end_at'),
        p_name: (form?.name ?? '').trim(),
        p_phone: (form?.phone ?? '').trim(),
      };
      const { error } = await supabase.rpc('create_reservation_rpc_json_v1', { payload });
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

  // cliente: cancelar desde “Tus citas”
  const cancelFromBanner = async (res: MyReservation) => {
    const token = await getClientTokenOrNull();
    if (!token) return;
    const { error } = await supabase.rpc('cancel_reservation_by_token_json', {
      payload: { p_reservation: res.id, p_client_token: token },
    });
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setMyReservations((prev) => prev.filter((x) => x.id !== res.id));
    reloadDay();
  };

  // navegación calendario (mes)
  const canGoPrev = currentDate.getTime() > minDate.getTime();
  const canGoNext = currentDate.getTime() < maxDate.getTime();

  const goPrevMonth = () => {
    const prev = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    if (endOfMonth(prev).getTime() < minDate.getTime()) return;
    setCurrentDate(stripTime(prev));
  };
  const goNextMonth = () => {
    const next = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    if (startOfMonth(next).getTime() > maxDate.getTime()) return;
    setCurrentDate(stripTime(next));
  };

  const monthStart = useMemo(() => startOfMonth(currentDate), [currentDate]);
  const gridStart = useMemo(() => startOfWeekSunday(monthStart), [monthStart]);
  const gridDays = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);

  const onPickCalendarDay = (d: Date) => {
    const t = stripTime(d).getTime();
    if (t < minDate.getTime() || t > maxDate.getTime()) return;
    setCurrentDate(stripTime(d));
    // al cambiar de día, si teníamos un slot seleccionado, lo limpiamos
    setReserveSlot(null);
  };

  // helpers
  async function safeOpenURL(url: string) {
    try {
      const can = await Linking.canOpenURL(url);
      if (can) await Linking.openURL(url);
      else Alert.alert('No se pudo abrir el mapa');
    } catch {
      Alert.alert('No se pudo abrir el mapa');
    }
  }

  function openPhone(phone?: string | null) {
    if (!phone) return;
    safeOpenURL(`tel:${phone}`);
  }

  function openMaps(lat?: number | null, lon?: number | null, address?: string | null) {
    if (lat != null && lon != null) {
      // URL universal de Google Maps
      const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
      safeOpenURL(url);
      return;
    }
    if (address && address.trim()) {
      const q = encodeURIComponent(address.trim());
      const url = `https://www.google.com/maps/search/?api=1&query=${q}`;
      safeOpenURL(url);
    }
  }

  // dos columnas
  function twoColumnChunks<T>(arr: T[]): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += 2) out.push(arr.slice(i, i + 2));
    return out;
  }

  const longMonth = useMemo(
    () => currentDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }),
    [currentDate]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <HeaderBar
        title={nameFromRoute ?? biz?.name ?? 'Detalle'}
        leftIcon="chevron-left"           // ← solo flecha
        onLeftPress={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        {/* Banner full-bleed */}
        <View style={styles.bannerWrap}>
          <ImageBackground
            source={
              biz?.banner_url
                ? { uri: biz.banner_url }
                : require('../assets/splash-icon.png')
            }
            resizeMode="cover"
            imageStyle={styles.bannerImage}
            style={styles.banner}
          >
            <View style={styles.bannerOverlay} />

            {/* Título */}
            <Text style={styles.bannerTitle}>{biz?.name ?? nameFromRoute ?? 'Peluquería'}</Text>

            {/* Botones acción */}
            <View style={styles.bannerButtonsRow}>
              <TouchableOpacity
                onPress={() => openPhone(biz?.phone_public)}
                style={[styles.bannerBtn, { backgroundColor: '#111' }]}
              >
                <Feather name="phone" size={16} color="#fff" />
                <Text style={styles.bannerBtnText}>Contacto</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => openMaps(biz?.lat, biz?.lon, biz?.address)} // ← lon
                style={[styles.bannerBtn, { backgroundColor: '#0a6' }]}
              >
                <Feather name="map-pin" size={16} color="#fff" />
                <Text style={styles.bannerBtnText}>Dónde estamos</Text>
              </TouchableOpacity>
            </View>

            {/* Panel de selección de cita (cuando hay reserveSlot) */}
            {reserveSlot && (
              <View style={styles.bannerSelection}>
                <Feather name="calendar" size={16} color="#fff" />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.selTitle}>Cita seleccionada</Text>
                  <Text style={styles.selSub}>
                    {new Date(reserveSlot.start_at).toLocaleDateString('es-ES', {
                      weekday: 'short',
                      day: '2-digit',
                      month: 'short',
                    })}{' '}
                    ·{' '}
                    {new Date(reserveSlot.start_at).toLocaleTimeString('es-ES', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' — '}
                    {new Date(reserveSlot.end_at).toLocaleTimeString('es-ES', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => setReserveOpen(true)}
                  style={[styles.selBtn, { backgroundColor: '#1b5e20' }]}
                >
                  <Text style={styles.selBtnText}>Continuar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setReserveSlot(null)}
                  style={[styles.selBtn, { backgroundColor: '#c62828', marginLeft: 8 }]}
                >
                  <Text style={styles.selBtnText}>Quitar</Text>
                </TouchableOpacity>
              </View>
            )}
          </ImageBackground>
        </View>

        {/* Banner "Tus citas" */}
        {myReservations.length > 0 && (
          <View style={[styles.myBanner, { marginHorizontal: 16 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.myBannerTitle}>
                {myReservations.length === 1 ? 'Tu cita' : 'Tus próximas citas'}
              </Text>
              {myReservations.map((res, i) => {
                const d = new Date(res.start_at);
                const datePart = d.toLocaleDateString('es-ES', {
                  weekday: 'short',
                  day: '2-digit',
                  month: 'short',
                });
                const timePart = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                return (
                  <View key={res.id} style={{ marginTop: i === 0 ? 2 : 8, flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.myBannerLine}>{`${datePart} · ${timePart}`}</Text>
                      <Text
                        style={[
                          styles.myBannerLine,
                          res.status === 'accepted'
                            ? { color: '#1b5e20', fontWeight: '800' }
                            : { color: '#b26a00', fontWeight: '800' },
                        ]}
                      >
                        {res.status === 'accepted' ? 'Aceptada' : 'Pendiente'}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => cancelFromBanner(res)} style={styles.myBannerBtn}>
                      <Feather name="x" size={16} color="#fff" />
                      <Text style={styles.myBannerBtnText}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Calendario mensual */}
        <View style={[styles.selectorCard, { marginHorizontal: 16 }]}>
          <View style={styles.selectorTopRow}>
            <TouchableOpacity
              onPress={goPrevMonth}
              disabled={!canGoPrev}
              style={[styles.roundBtn, !canGoPrev && styles.roundBtnDisabled]}
            >
              <Feather name="chevron-left" size={18} color={canGoPrev ? '#111' : '#bbb'} />
            </TouchableOpacity>

            <View style={{ alignItems: 'center' }}>
              <Text style={styles.selectorTitle} numberOfLines={1}>
                {longMonth}
              </Text>
              <Text style={styles.selectorSub}>{toYmd(currentDate)}</Text>
            </View>

            <TouchableOpacity
              onPress={goNextMonth}
              disabled={!canGoNext}
              style={[styles.roundBtn, !canGoNext && styles.roundBtnDisabled]}
            >
              <Feather name="chevron-right" size={18} color={canGoNext ? '#111' : '#bbb'} />
            </TouchableOpacity>
          </View>

          <View style={styles.calendarWeekHeader}>
            {['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'].map((d) => (
              <Text key={d} style={styles.calendarWeekHeaderText}>
                {d}
              </Text>
            ))}
          </View>

          <View style={styles.calendarGrid}>
            {gridDays.map((d, i) => {
              const t = stripTime(d).getTime();
              const outOfMonth = d.getMonth() !== currentDate.getMonth();
              const outOfRange = t < minDate.getTime() || t > maxDate.getTime();
              const isSelected = t === stripTime(currentDate).getTime();
              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => onPickCalendarDay(d)}
                  disabled={outOfRange}
                  style={[
                    styles.calendarCell,
                    outOfMonth && styles.calendarCellOutMonth,
                    isSelected && styles.calendarCellSelected,
                    outOfRange && styles.calendarCellDisabled,
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

        {/* Banner de vacaciones */}
        {dayClosed.closed && (
          <View style={[styles.closedBanner, { marginHorizontal: 16 }]}>
            <Text style={styles.closedTitle}>Cerrado por vacaciones</Text>
            {!!dayClosed.message && <Text style={styles.closedMsg}>{dayClosed.message}</Text>}
          </View>
        )}

        {/* Lista de horas en 2 columnas — OCULTA si hay reserveSlot */}
        {!dayClosed.closed && !reserveSlot && (
          <View style={[styles.card, { marginHorizontal: 16 }]}>
            <Text style={styles.cardTitle}>Horarios</Text>
            {loadingDay ? (
              <View style={{ paddingVertical: 10 }}>
                <ActivityIndicator />
              </View>
            ) : slots.length === 0 ? (
              <Text style={{ color: '#666' }}>No hay horarios para este día.</Text>
            ) : (
              <View style={{ gap: 10 }}>
                {twoColumnChunks(slots).map((pair, rowIdx) => (
                  <View key={rowIdx} style={styles.slotRow2}>
                    {pair.map((s, colIdx) => {
                      const t = new Date(s.start_at);
                      const hh = pad2(t.getHours());
                      const mm = pad2(t.getMinutes());
                      const past = isPastSlot(s.start_at);

                      let bg = '#e8f5e9',
                        fg = '#1b5e20',
                        label = 'Libre';
                      let right: React.ReactNode = <Feather name="chevron-right" size={16} color={fg} />;

                      if (s.is_free && past) {
                        bg = '#f5f5f5';
                        fg = '#9e9e9e';
                        label = 'Pasada';
                        right = null;
                      }
                      if (!s.is_free) {
                        if (s.occupant_status === 'pending') {
                          bg = '#f0f0f0';
                          fg = '#555';
                          label = 'Pendiente';
                        } else {
                          bg = '#ffebee';
                          fg = '#b71c1c';
                          label = 'Ocupada';
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
                          } else if (s.is_mine) {
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

                      const CellContent = (
                        <View style={[styles.slotCell, { backgroundColor: bg }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.slotHour, { color: fg }]}>{hh}:{mm}</Text>
                            <Text style={[styles.slotSub, { color: fg }]}>{label}</Text>

                            {!s.is_free && isOwner && (
                              <Text style={{ color: fg, opacity: 0.9 }} numberOfLines={1} ellipsizeMode="tail">
                                {s.occupant_name ?? ''}
                                {s.occupant_phone ? ((s.occupant_name ? ' • ' : '') + s.occupant_phone) : ''}
                              </Text>
                            )}
                            {!s.is_free && !isOwner && s.is_mine && (
                              <Text style={{ color: fg, opacity: 0.9 }} numberOfLines={1} ellipsizeMode="tail">
                                {s.mine_name ?? ''}
                                {s.mine_phone ? ((s.mine_name ? ' • ' : '') + s.mine_phone) : ''}
                              </Text>
                            )}
                          </View>
                          {right}
                        </View>
                      );

                      const key = `${rowIdx}-${colIdx}`;
                      return s.is_free ? (
                        <TouchableOpacity
                          key={key}
                          activeOpacity={0.9}
                          onPress={() => onPressFree(s)}
                          style={{ flex: 1 }}
                        >
                          {CellContent}
                        </TouchableOpacity>
                      ) : (
                        <View key={key} style={{ flex: 1 }}>
                          {CellContent}
                        </View>
                      );
                    })}
                    {pair.length === 1 && <View style={{ flex: 1 }} />}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Modal de reserva */}
      <ReserveModal
        visible={reserveOpen}
        onClose={() => {
          setReserveOpen(false);
          // mantenemos el panel en banner con el slot elegido (UX: el usuario puede reabrir)
        }}
        onConfirm={confirmReservation}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  // Banner full-bleed integrado con marco del móvil
  bannerWrap: {
    marginBottom: 14,
  },
  banner: {
    height: 220,
    // ocupa todo el ancho de pantalla (fuera del padding):
    marginLeft: 0,
    marginRight: 0,
  },
  bannerImage: {
    // sin bordes: integrado total
  },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.30)',
  },
  bannerTitle: {
    position: 'absolute',
    top: 14,
    left: 16,
    right: 16,
    color: '#fff',
    fontWeight: '900',
    fontSize: 22,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowRadius: 6,
  },
  bannerButtonsRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
    flexDirection: 'row',
    gap: 10,
  },
  bannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  bannerBtnText: { color: '#fff', fontWeight: '800', marginLeft: 8 },

  // Panel de selección incrustado en banner
  bannerSelection: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 64,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  selTitle: { color: '#fff', fontWeight: '900' },
  selSub: { color: '#fff', opacity: 0.95 },
  selBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  selBtnText: { color: '#fff', fontWeight: '800' },

  // Banner "Tu cita"
  myBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef5ff',
    borderWidth: 1,
    borderColor: '#d6e4ff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  myBannerTitle: { fontWeight: '800', marginBottom: 2, color: '#113' },
  myBannerLine: { color: '#224', fontSize: 13 },
  myBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#c62828',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginLeft: 10,
  },
  myBannerBtnText: { color: '#fff', fontWeight: '700', marginLeft: 6 },

  // Selector (calendario mensual)
  selectorCard: {
    backgroundColor: '#f7f7f7',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#eee',
    padding: 12,
    marginBottom: 14,
  },
  selectorTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  roundBtn: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBtnDisabled: { opacity: 0.5 },
  selectorTitle: { fontWeight: '800', textTransform: 'capitalize' },
  selectorSub: { color: '#777', fontSize: 12 },

  calendarWeekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  calendarWeekHeaderText: { width: `${100 / 7}%`, textAlign: 'center', fontWeight: '800', color: '#333' },

  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    marginVertical: 3,
  },
  calendarCellOutMonth: { opacity: 0.6 },
  calendarCellSelected: { backgroundColor: '#111' },
  calendarCellDisabled: { opacity: 0.25 },
  calendarCellText: { fontWeight: '800', color: '#333' },
  calendarCellTextOutMonth: { color: '#666' },
  calendarCellTextSelected: { color: '#fff' },
  calendarCellTextDisabled: { color: '#777' },

  // Lista de slots (2 columnas)
  card: {
    backgroundColor: '#fafafa',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#eee',
    marginBottom: 14,
  },
  cardTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  slotRow2: {
    flexDirection: 'row',
    gap: 10,
  },
  slotCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 64,
  },
  slotHour: { fontSize: 16, fontWeight: '800' },
  slotSub: { fontSize: 13, fontWeight: '700', opacity: 0.95, marginTop: 2, lineHeight: 18 },

  // Vacaciones
  closedBanner: {
    backgroundColor: '#ffeaea',
    borderColor: '#ffcccc',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  closedTitle: { fontWeight: '800', color: '#b71c1c' },
  closedMsg: { marginTop: 4, color: '#b71c1c' },

  // Botones dueño
  iconBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    minWidth: 36,
    alignItems: 'center',
  },
});
