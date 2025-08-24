import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HeaderBar from '../components/HeaderBar';
import { supabase } from '../lib/supabase';
import { Feather } from '@expo/vector-icons';

type MyBusiness = {
  id: string;
  name: string;
  default_duration_minutes: number | null;
  pending_duration_minutes: number | null;
  pending_applies_from: string | null; // ISO date
};

const DURATIONS = [20, 30, 40] as const;
type DurationOpt = typeof DURATIONS[number];

type DaySlot = { slot_id?: number; opens: string; closes: string }; // HH:MM
type WeekMap = Record<number, DaySlot[]>; // 0..6

const WEEK_LABELS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];
const WEEK_FULL = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

function isHHMM(v: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim());
}
function toMinutes(v: string) {
  const [h, m] = v.split(':').map(n => parseInt(n, 10));
  return h * 60 + m;
}

export default function OwnerSettings() {
  const insets = useSafeAreaInsets();

  // --- DURACIÓN ---
  const [loading, setLoading] = useState(true);
  const [savingDur, setSavingDur] = useState(false);
  const [biz, setBiz] = useState<MyBusiness | null>(null);
  const [selectedDur, setSelectedDur] = useState<DurationOpt | null>(null);

  // --- PLANTILLA SEMANAL ---
  const [weekLoading, setWeekLoading] = useState(true);
  const [weekSaving, setWeekSaving] = useState(false);
  const [week, setWeek] = useState<WeekMap>({ 0:[],1:[],2:[],3:[],4:[],5:[],6:[] });
  const [currentDay, setCurrentDay] = useState<number>(1); // Lunes por defecto (1)
  const [newOpen, setNewOpen] = useState('');
  const [newClose, setNewClose] = useState('');

  // Cargar negocio del dueño + duración
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id;
      if (!uid) {
        setBiz(null);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('businesses')
        .select('id, name, default_duration_minutes, pending_duration_minutes, pending_applies_from')
        .eq('owner_user_id', uid)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('load owner business error:', error.message);
        Alert.alert('Error', 'No se pudo cargar tu negocio.');
        setBiz(null);
      } else if (data) {
        setBiz(data as MyBusiness);
        const pre =
          (data.pending_duration_minutes as number | null) ??
          (data.default_duration_minutes as number | null) ??
          30;
        setSelectedDur(pre as DurationOpt);
      } else {
        setBiz(null);
      }
      setLoading(false);
    })();
  }, []);

  // Cargar plantilla semanal
  const reloadWeek = async (businessId: string) => {
    setWeekLoading(true);
    const empty: WeekMap = { 0:[],1:[],2:[],3:[],4:[],5:[],6:[] };
    const { data, error } = await supabase.rpc('owner_get_week_schedule', { p_business: businessId });
    if (error) {
      console.warn('owner_get_week_schedule error:', error.message);
      Alert.alert('Error', 'No se pudo cargar la plantilla semanal.');
      setWeek(empty);
    } else {
      const map: WeekMap = { 0:[],1:[],2:[],3:[],4:[],5:[],6:[] };
      (data as any[]).forEach(row => {
        const wd = row.weekday as number;
        const opens = (row.opens as string).slice(0,5);
        const closes = (row.closes as string).slice(0,5);
        map[wd].push({ slot_id: row.slot_id, opens, closes });
      });
      // Asegurar orden
      for (let i=0;i<7;i++) {
        map[i].sort((a,b) => toMinutes(a.opens) - toMinutes(b.opens));
      }
      setWeek(map);
    }
    setWeekLoading(false);
  };

  useEffect(() => {
    if (biz?.id) reloadWeek(biz.id);
  }, [biz?.id]);

  // Datos de duración para mostrar
  const activeToday = biz?.default_duration_minutes ?? null;
  const pendingDur = biz?.pending_duration_minutes ?? null;
  const pendingFrom = biz?.pending_applies_from ?? null;

  const pendingText = useMemo(() => {
    if (!pendingDur || !pendingFrom) return null;
    const d = new Date(pendingFrom + 'T00:00:00');
    const dateFmt = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    return `Programada desde ${dateFmt}: ${pendingDur} min`;
  }, [pendingDur, pendingFrom]);

  // Guardar duración (desde mañana)
  const saveDuration = async () => {
    if (!biz?.id || !selectedDur) return;
    setSavingDur(true);
    const { error, data } = await supabase.rpc('owner_set_duration', {
      p_business: biz.id,
      p_minutes: selectedDur,
    });
    setSavingDur(false);
    if (error) {
      console.warn('owner_set_duration error:', error.message);
      Alert.alert('Error', 'No se pudo guardar la duración.');
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as any;
    setBiz({
      id: row.business_id ?? biz.id,
      name: biz.name,
      default_duration_minutes: row.current_duration ?? biz.default_duration_minutes,
      pending_duration_minutes: row.pending_duration ?? selectedDur,
      pending_applies_from: row.applies_from,
    });
    Alert.alert('Guardado', 'La nueva duración aplicará desde mañana.');
  };

  // ---- CRUD de tramos por día ----

  const listForDay = week[currentDay] || [];

  const addLocalSlot = () => {
    const op = newOpen.trim();
    const cl = newClose.trim();
    if (!isHHMM(op) || !isHHMM(cl)) {
      Alert.alert('Formato inválido', 'Usa HH:MM (ej. 08:00).');
      return;
    }
    const mo = toMinutes(op), mc = toMinutes(cl);
    if (mo >= mc) {
      Alert.alert('Rango inválido', 'La hora de apertura debe ser menor que la de cierre.');
      return;
    }
    // Validar solapes contra la lista existente
    const arr = [...listForDay];
    // Insertar en orden por opens
    let inserted = false;
    for (let i=0;i<arr.length;i++) {
      if (toMinutes(arr[i].opens) > mo) {
        arr.splice(i, 0, { opens: op, closes: cl });
        inserted = true;
        break;
      }
    }
    if (!inserted) arr.push({ opens: op, closes: cl });

    // Comprobar solapes
    for (let i=0;i<arr.length;i++) {
      const a = arr[i];
      const aS = toMinutes(a.opens), aE = toMinutes(a.closes);
      if (aS >= aE) { Alert.alert('Rango inválido', 'Apertura debe ser menor que cierre.'); return; }
      if (i>0) {
        const prev = arr[i-1];
        const pS = toMinutes(prev.opens), pE = toMinutes(prev.closes);
        if (aS < pE) { Alert.alert('Solape', 'Los tramos no pueden solaparse.'); return; }
      }
    }

    setWeek(prev => ({ ...prev, [currentDay]: arr }));
    setNewOpen('');
    setNewClose('');
  };

  const deleteLocalSlot = (index: number) => {
    const arr = [...listForDay];
    arr.splice(index, 1);
    setWeek(prev => ({ ...prev, [currentDay]: arr }));
  };

  const saveDay = async () => {
    if (!biz?.id) return;
    // Validación final (ya debería estar bien, pero por si acaso)
    const arr = [...listForDay];
    for (let i=0;i<arr.length;i++) {
      const aS = toMinutes(arr[i].opens), aE = toMinutes(arr[i].closes);
      if (aS >= aE) { Alert.alert('Rango inválido', 'Revisa las horas.'); return; }
      if (i>0) {
        const pE = toMinutes(arr[i-1].closes);
        if (aS < pE) { Alert.alert('Solape', 'Revisa que no haya solapes.'); return; }
      }
    }

    setWeekSaving(true);
    const payload = arr.map(s => ({ opens: s.opens, closes: s.closes }));
    const { error } = await supabase.rpc('owner_set_weekday_slots', {
      p_business: biz.id,
      p_weekday: currentDay,
      p_slots: payload,
    });
    setWeekSaving(false);
    if (error) {
      console.warn('owner_set_weekday_slots error:', error.message);
      Alert.alert('Error', 'No se pudo guardar el día.');
      return;
    }
    Alert.alert('Guardado', `${WEEK_FULL[currentDay]} actualizado.`);
    // Refrescar desde servidor (para obtener ids, etc.)
    reloadWeek(biz.id);
  };

  const resetDay = async () => {
    if (!biz?.id) return;
    setWeekSaving(true);
    const { error } = await supabase.rpc('owner_set_weekday_slots', {
      p_business: biz.id,
      p_weekday: currentDay,
      p_slots: [], // => borra todos
    });
    setWeekSaving(false);
    if (error) {
      console.warn('owner_set_weekday_slots reset error:', error.message);
      Alert.alert('Error', 'No se pudo restablecer el día.');
      return;
    }
    setWeek(prev => ({ ...prev, [currentDay]: [] }));
    Alert.alert('Restablecido', `${WEEK_FULL[currentDay]} sin tramos.`);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 8) }]}>
      <HeaderBar
        title="Panel del dueño"
        rightLabel="Salir"
        onRightPress={async () => { await supabase.auth.signOut(); }}
      />

      {loading ? (
        <View style={{ padding: 16 }}><ActivityIndicator /></View>
      ) : !biz ? (
        <View style={{ padding: 16 }}>
          <Text>No se encontró un negocio asociado a tu cuenta.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {/* Duración de la cita */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Duración de la cita</Text>
            <Text style={styles.cardDesc}>
              Cambia la duración a 20/30/40 min. El cambio aplicará automáticamente <Text style={{ fontWeight: '700' }}>desde mañana</Text>.
            </Text>

            <View style={styles.infoBox}>
              <Text style={styles.infoLine}>
                Activa hoy: <Text style={styles.bold}>{biz.default_duration_minutes ?? '—'} min</Text>
              </Text>
              {pendingText && <Text style={[styles.infoLine, { color: '#555' }]}>{pendingText}</Text>}
            </View>

            <View style={styles.radioRow}>
              {DURATIONS.map((m) => {
                const checked = selectedDur === m;
                return (
                  <TouchableOpacity key={m} style={styles.radioItem} onPress={() => setSelectedDur(m)}>
                    <View style={[styles.radioCircle, checked && styles.radioCircleChecked]}>
                      {checked && <View style={styles.radioDot} />}
                    </View>
                    <Text style={styles.radioLabel}>{m} min</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity disabled={savingDur || !selectedDur} onPress={saveDuration} style={[styles.primaryBtn, savingDur && { opacity: 0.6 }]}>
              <Text style={styles.primaryBtnText}>{savingDur ? 'Guardando…' : 'Guardar'}</Text>
            </TouchableOpacity>
          </View>

          {/* Plantilla semanal */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Plantilla semanal</Text>
            <Text style={styles.cardDesc}>
              Define tus tramos por día. Los tramos no pueden solaparse y deben usar formato HH:MM.
            </Text>

            {/* Selector de día */}
            <View style={styles.dayRow}>
              {WEEK_LABELS.map((lab, idx) => (
                <TouchableOpacity key={idx} onPress={() => setCurrentDay(idx)} style={[styles.dayChip, currentDay === idx && styles.dayChipSel]}>
                  <Text style={[styles.dayChipText, currentDay === idx && styles.dayChipTextSel]}>{lab}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {weekLoading ? (
              <View style={{ paddingVertical: 10 }}><ActivityIndicator /></View>
            ) : (
              <>
                {/* Lista de tramos del día */}
                {listForDay.length === 0 ? (
                  <View style={{ paddingVertical: 6 }}>
                    <Text style={{ color: '#666' }}>No hay tramos para {WEEK_FULL[currentDay]}.</Text>
                  </View>
                ) : (
                  <View>
                    {listForDay.map((item, index) => (
                      <View key={`${currentDay}-${index}`} style={styles.slotRow}>
                        <Text style={styles.slotText}>{item.opens}–{item.closes}</Text>
                        <TouchableOpacity onPress={() => deleteLocalSlot(index)} style={styles.deleteBtn}>
                          <Feather name="trash-2" size={16} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {/* Formulario añadir tramo */}
                <View style={styles.addRow}>
                  <TextInput
                    placeholder="HH:MM"
                    value={newOpen}
                    onChangeText={setNewOpen}
                    style={styles.input}
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                  />
                  <Text style={{ marginHorizontal: 6, color: '#666' }}>–</Text>
                  <TextInput
                    placeholder="HH:MM"
                    value={newClose}
                    onChangeText={setNewClose}
                    style={styles.input}
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={addLocalSlot} style={styles.addBtn}>
                    <Text style={styles.addBtnText}>Añadir</Text>
                  </TouchableOpacity>
                </View>

                {/* Acciones */}
                <View style={styles.actionsRow}>
                  <TouchableOpacity disabled={weekSaving} onPress={saveDay} style={[styles.primaryBtn, { flex: 1 }, weekSaving && { opacity: 0.6 }]}>
                    <Text style={styles.primaryBtnText}>{weekSaving ? 'Guardando…' : `Guardar ${WEEK_FULL[currentDay]}`}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={weekSaving} onPress={resetDay} style={[styles.resetBtn, { marginLeft: 8 }]}>
                    <Text style={styles.resetBtnText}>Restablecer día</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          {/* Excepciones (placeholder) */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Excepciones por día</Text>
            <Text style={styles.cardDesc}>Cierra un día o define horario especial. (Siguiente paso)</Text>
            <View style={styles.placeholderBox}><Text style={styles.placeholderText}>[Editor de excepciones por fecha]</Text></View>
          </View>

          {/* Vacaciones (placeholder) */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Vacaciones / Cierres por rango</Text>
            <Text style={styles.cardDesc}>Marca un rango de cierre con mensaje. (Siguiente paso)</Text>
            <View style={styles.placeholderBox}><Text style={styles.placeholderText}>[Gestor de rangos de cierre]</Text></View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  // ---------- Cards ----------
  card: { backgroundColor: '#fafafa', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#eee', marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: '800', marginBottom: 6 },
  cardDesc: { color: '#555', marginBottom: 12 },

  // ---------- Duración ----------
  infoBox: { backgroundColor: '#fff', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#eee', marginBottom: 12 },
  infoLine: { fontSize: 14, marginBottom: 2 },
  bold: { fontWeight: '800' },
  radioRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  radioItem: { flexDirection: 'row', alignItems: 'center' },
  radioCircle: { width: 20, height: 20, borderRadius: 12, borderWidth: 2, borderColor: '#999', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  radioCircleChecked: { borderColor: '#111' },
  radioDot: { width: 10, height: 10, borderRadius: 6, backgroundColor: '#111' },
  radioLabel: { fontSize: 14, fontWeight: '700' },

  primaryBtn: { paddingVertical: 12, borderRadius: 10, backgroundColor: '#111', alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700' },

  // ---------- Semana ----------
  dayRow: { flexDirection: 'row', marginBottom: 10, },
  dayChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#f2f2f2', marginRight: 6 },
  dayChipSel: { backgroundColor: '#111' },
  dayChipText: { color: '#333', fontWeight: '800' },
  dayChipTextSel: { color: '#fff', fontWeight: '800' },

  slotRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8
  },
  slotText: { fontWeight: '700' },
  deleteBtn: { backgroundColor: '#c62828', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },

  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, minWidth: 80 },
  addBtn: { marginLeft: 8, backgroundColor: '#111', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  addBtnText: { color: '#fff', fontWeight: '700' },

  actionsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },

  resetBtn: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#eee' },
  resetBtnText: { color: '#333', fontWeight: '700' },

  // ---------- Placeholders ----------
  placeholderBox: { borderWidth: 1, borderColor: '#ddd', borderStyle: 'dashed', borderRadius: 12, padding: 16, alignItems: 'center', justifyContent: 'center' },
  placeholderText: { color: '#888' },
});
