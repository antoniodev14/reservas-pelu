import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Alert, TextInput, KeyboardAvoidingView, Platform, Keyboard
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HeaderBar from '../components/HeaderBar';
import { supabase } from '../lib/supabase';
import { Feather } from '@expo/vector-icons';

// ------------ Tipos ------------
type MyBusiness = {
  id: string;
  name: string;
  default_duration_minutes: number | null;
  pending_duration_minutes: number | null;
  pending_applies_from: string | null; // ISO date (YYYY-MM-DD)
};

type DaySlot = { slot_id?: number; opens: string; closes: string }; // HH:MM
type WeekMap = Record<number, DaySlot[]>; // 0..6

type Closure = { id: number; starts_on: string; ends_on: string; message: string | null };

// ------------ Constantes ------------
const DURATIONS = [20, 30, 40] as const;
type DurationOpt = typeof DURATIONS[number];

const WEEK_LABELS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];
const WEEK_FULL = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

// ------------ Helpers ------------
function isHHMM(v: string) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim()); }
function toMinutes(v: string) { const [h,m]=v.split(':').map(n=>parseInt(n,10)); return h*60+m; }
function formatHHMMDigitsOnly(input: string) {
  const digits = input.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + ':' + digits.slice(2);
}
// DD-MM-YYYY
function formatDMYOnly(input: string) {
  const d = input.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return d.slice(0,2) + '-' + d.slice(2);
  return d.slice(0,2) + '-' + d.slice(2,4) + '-' + d.slice(4);
}
function isDMY(v: string) {
  if (!/^\d{2}-\d{2}-\d{4}$/.test(v)) return false;
  const [dd, mm, yyyy] = v.split('-').map(n=>parseInt(n,10));
  if (mm<1||mm>12) return false;
  const dim = new Date(yyyy, mm, 0).getDate();
  return dd>=1 && dd<=dim;
}
function dmyToYmd(v: string) {
  const [dd, mm, yyyy] = v.split('-'); return `${yyyy}-${mm}-${dd}`;
}

export default function OwnerSettings() {
  const insets = useSafeAreaInsets();

  // Teclado (para iOS desplazar)
  const [kbVisible, setKbVisible] = useState(false);
  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(show, () => setKbVisible(true));
    const h = Keyboard.addListener(hide, () => setKbVisible(false));
    return () => { s.remove(); h.remove(); };
  }, []);

  // --- Estado negocio / duración ---
  const [loading, setLoading] = useState(true);
  const [biz, setBiz] = useState<MyBusiness | null>(null);
  const [selectedDur, setSelectedDur] = useState<DurationOpt | null>(null);
  const [savingDur, setSavingDur] = useState(false);

  // --- Plantilla semanal ---
  const [weekLoading, setWeekLoading] = useState(true);
  const [weekSaving, setWeekSaving] = useState(false);
  const [week, setWeek] = useState<WeekMap>({0:[],1:[],2:[],3:[],4:[],5:[],6:[]});
  const [currentDay, setCurrentDay] = useState<number>(1);
  const [newOpen, setNewOpen] = useState('');
  const [newClose, setNewClose] = useState('');

  // --- Vacaciones ---
  const [closures, setClosures] = useState<Closure[]>([]);
  const [cvStart, setCvStart] = useState('');
  const [cvEnd, setCvEnd] = useState('');
  const [cvMsg, setCvMsg] = useState('');
  const [cvLoading, setCvLoading] = useState(false);

  // Cargar negocio del dueño + duración
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id;
      if (!uid) { setBiz(null); setLoading(false); return; }

      const { data, error } = await supabase
        .from('businesses')
        .select('id, name, default_duration_minutes, pending_duration_minutes, pending_applies_from')
        .eq('owner_user_id', uid)
        .maybeSingle();

      if (error || !data) {
        setBiz(null);
        setLoading(false);
        Alert.alert('Error','No se pudo cargar tu negocio.');
        return;
      }

      const b = data as MyBusiness;
      setBiz(b);
      const pre = (b.pending_duration_minutes ?? b.default_duration_minutes ?? 30) as DurationOpt;
      setSelectedDur(pre);
      setLoading(false);
    })();
  }, []);

  // Texto informativo de pendiente
  const pendingText = useMemo(() => {
    if (!biz?.pending_duration_minutes || !biz?.pending_applies_from) return null;
    const d = new Date(biz.pending_applies_from + 'T00:00:00');
    const dateFmt = d.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
    return `Programada desde ${dateFmt}: ${biz.pending_duration_minutes} min`;
  }, [biz?.pending_duration_minutes, biz?.pending_applies_from]);

  // Guardar duración (aplica desde mañana según tu RPC owner_set_duration)
  const saveDuration = async () => {
    if (!biz?.id || !selectedDur) return;
    setSavingDur(true);
    const { data, error } = await supabase.rpc('owner_set_duration', {
      p_business: biz.id,
      p_minutes: selectedDur,
    });
    setSavingDur(false);
    if (error) {
      console.warn('owner_set_duration', error.message);
      Alert.alert('Error', 'No se pudo guardar la duración.');
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as any;
    setBiz(prev => prev ? ({
      ...prev,
      default_duration_minutes: row.current_duration ?? prev.default_duration_minutes,
      pending_duration_minutes: row.pending_duration ?? selectedDur,
      pending_applies_from: row.applies_from ?? prev.pending_applies_from,
    }) : prev);
    Alert.alert('Guardado', 'La nueva duración aplicará desde mañana.');
  };

  // --- Plantilla: cargar, añadir, borrar, guardar ---
  const reloadWeek = async (businessId: string) => {
    setWeekLoading(true);
    const { data, error } = await supabase.rpc('owner_get_week_schedule', { p_business: businessId });
    setWeekLoading(false);
    if (error) {
      console.warn('owner_get_week_schedule', error.message);
      Alert.alert('Error', 'No se pudo cargar la plantilla semanal.');
      setWeek({0:[],1:[],2:[],3:[],4:[],5:[],6:[]});
      return;
    }
    const map: WeekMap = {0:[],1:[],2:[],3:[],4:[],5:[],6:[]};
    (data as any[]).forEach(row => {
      const wd = row.weekday as number;
      const opens = (row.opens as string).slice(0,5);
      const closes = (row.closes as string).slice(0,5);
      map[wd].push({ slot_id: row.slot_id, opens, closes });
    });
    for (let i=0;i<7;i++) map[i].sort((a,b)=>toMinutes(a.opens)-toMinutes(b.opens));
    setWeek(map);
  };
  useEffect(()=>{ if (biz?.id) reloadWeek(biz.id); }, [biz?.id]);

  const listForDay = week[currentDay] || [];

  const addLocalSlot = () => {
    const op=newOpen.trim(), cl=newClose.trim();
    if (!isHHMM(op)||!isHHMM(cl)) { Alert.alert('Formato inválido','Usa HH:MM (ej. 08:00).'); return; }
    if (toMinutes(op)>=toMinutes(cl)) { Alert.alert('Rango inválido','Apertura debe ser menor que cierre.'); return; }
    const arr=[...listForDay]; let inserted=false;
    for(let i=0;i<arr.length;i++){ if(toMinutes(arr[i].opens)>toMinutes(op)){ arr.splice(i,0,{opens:op,closes:cl}); inserted=true; break; } }
    if(!inserted) arr.push({opens:op,closes:cl});
    // validar solapes
    for(let i=0;i<arr.length;i++){
      const s=toMinutes(arr[i].opens), e=toMinutes(arr[i].closes);
      if(s>=e){ Alert.alert('Rango inválido'); return; }
      if(i>0 && s<toMinutes(arr[i-1].closes)){ Alert.alert('Solape','Los tramos no pueden solaparse.'); return; }
    }
    setWeek(prev=>({ ...prev, [currentDay]: arr }));
    setNewOpen(''); setNewClose('');
  };

  const deleteLocalSlot = (index: number) => {
    const arr=[...listForDay]; arr.splice(index,1);
    setWeek(prev=>({ ...prev, [currentDay]: arr }));
  };

  const saveDay = async () => {
    if (!biz?.id) return;
    const payload = listForDay.map(s => ({ opens: s.opens, closes: s.closes }));
    setWeekSaving(true);
    const { error } = await supabase.rpc('owner_set_weekday_slots', {
      p_business: biz.id, p_weekday: currentDay, p_slots: payload
    });
    setWeekSaving(false);
    if (error) { console.warn('owner_set_weekday_slots', error.message); Alert.alert('Error','No se pudo guardar el día.'); return; }
    Alert.alert('Guardado', `${WEEK_FULL[currentDay]} actualizado.`);
    reloadWeek(biz.id);
  };

  const resetDay = async () => {
    if (!biz?.id) return;
    setWeekSaving(true);
    const { error } = await supabase.rpc('owner_set_weekday_slots', {
      p_business: biz.id, p_weekday: currentDay, p_slots: []
    });
    setWeekSaving(false);
    if (error) { console.warn('owner_set_weekday_slots reset', error.message); Alert.alert('Error','No se pudo restablecer el día.'); return; }
    setWeek(prev=>({ ...prev, [currentDay]: [] }));
    Alert.alert('Restablecido', `${WEEK_FULL[currentDay]} sin tramos.`);
  };

  // --- Vacaciones: listar / añadir / borrar ---
  const reloadClosures = async (businessId: string)=>{
    setCvLoading(true);
    const { data, error } = await supabase.rpc('owner_list_closures', { p_business: businessId });
    setCvLoading(false);
    if (error) { console.warn('owner_list_closures', error.message); Alert.alert('Error','No se pudo cargar vacaciones.'); setClosures([]); return; }
    const rows = (data as any[]).map(r => ({ id:r.closure_id, starts_on:r.starts_on, ends_on:r.ends_on, message:r.message ?? null }));
    setClosures(rows);
  };
  useEffect(()=>{ if (biz?.id) reloadClosures(biz.id); }, [biz?.id]);

  const addClosure = async ()=>{
    if (!biz?.id) return;
    const s=cvStart.trim(), e=cvEnd.trim();
    if (!isDMY(s)||!isDMY(e)) { Alert.alert('Fecha inválida', 'Usa DD-MM-YYYY.'); return; }
    const yS = dmyToYmd(s), yE = dmyToYmd(e);
    if (yS > yE) { Alert.alert('Rango inválido', 'La fecha de inicio debe ser menor o igual a la de fin.'); return; }
    setCvLoading(true);
    const { error } = await supabase.rpc('owner_add_closure', {
      p_business: biz.id, p_starts_on: yS, p_ends_on: yE, p_message: cvMsg || null
    });
    setCvLoading(false);
    if (error) {
      const map:Record<string,string> = {
        not_owner:'No eres el dueño.',
        invalid_dates:'Fechas incompletas.',
        starts_after_ends:'Inicio posterior al fin.',
        overlap_with_existing:'Solapa con otro cierre.',
      };
      Alert.alert('No se pudo añadir', map[error.message] || 'Inténtalo de nuevo.');
      return;
    }
    setCvStart(''); setCvEnd(''); setCvMsg('');
    reloadClosures(biz.id);
  };

  const deleteClosure = async (id: number)=>{
    if (!biz?.id) return;
    setCvLoading(true);
    const { error } = await supabase.rpc('owner_delete_closure', { p_business: biz.id, p_id: id });
    setCvLoading(false);
    if (error) { Alert.alert('Error','No se pudo borrar.'); return; }
    setClosures(prev=>prev.filter(c=>c.id!==id));
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8, paddingBottom: kbVisible ? 0 : Math.max(insets.bottom, 8) }]}>
      <HeaderBar title="Panel del dueño" rightLabel="Salir" onRightPress={async ()=>{ await supabase.auth.signOut(); }} />
      {loading || !biz ? (
        <View style={{ padding:16 }}>{loading ? <ActivityIndicator/> : <Text>No hay negocio asociado.</Text>}</View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} keyboardVerticalOffset={Platform.OS==='ios'?insets.top:0} style={{flex:1}}>
          <ScrollView contentContainerStyle={{ padding:16, paddingBottom: kbVisible ? 8 : 16 }} keyboardShouldPersistTaps="handled">

            {/* Duración de la cita */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Duración de la cita</Text>
              <Text style={styles.cardDesc}>
                Cambia a 20/30/40 min. El cambio aplicará <Text style={{fontWeight:'800'}}>desde mañana</Text>.
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
              <Text style={styles.cardDesc}>Define tus tramos por día. Formato HH:MM sin solapes.</Text>
              <View style={styles.dayRow}>
                {WEEK_LABELS.map((lab, idx)=>(
                  <TouchableOpacity key={idx} onPress={()=>setCurrentDay(idx)} style={[styles.dayChip, currentDay===idx && styles.dayChipSel]}>
                    <Text style={[styles.dayChipText, currentDay===idx && styles.dayChipTextSel]}>{lab}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {weekLoading ? (
                <ActivityIndicator/>
              ) : (
                <>
                  {listForDay.length===0 ? (
                    <Text style={{color:'#666'}}>Sin tramos para {WEEK_FULL[currentDay]}.</Text>
                  ) : (
                    <View>
                      {listForDay.map((it, i)=>(
                        <View key={i} style={styles.slotRow}>
                          <Text style={styles.slotText}>{it.opens}–{it.closes}</Text>
                          <TouchableOpacity onPress={()=>deleteLocalSlot(i)} style={styles.deleteBtn}>
                            <Feather name="trash-2" size={16} color="#fff"/>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                  <View style={styles.addRow}>
                    <TextInput placeholder="HH:MM" value={newOpen} onChangeText={(t)=>setNewOpen(formatHHMMDigitsOnly(t))}
                      style={styles.input} keyboardType={Platform.OS==='ios'?'number-pad':'numeric'} inputMode="numeric" maxLength={5} autoCapitalize="none"/>
                    <Text style={{marginHorizontal:6,color:'#666'}}>–</Text>
                    <TextInput placeholder="HH:MM" value={newClose} onChangeText={(t)=>setNewClose(formatHHMMDigitsOnly(t))}
                      style={styles.input} keyboardType={Platform.OS==='ios'?'number-pad':'numeric'} inputMode="numeric" maxLength={5} autoCapitalize="none"/>
                    <TouchableOpacity onPress={addLocalSlot} style={styles.addBtn}><Text style={styles.addBtnText}>Añadir</Text></TouchableOpacity>
                  </View>
                  <View style={styles.actionsRow}>
                    <TouchableOpacity disabled={weekSaving} onPress={saveDay} style={[styles.primaryBtn, {flex:1}, weekSaving && {opacity:.6}]}>
                      <Text style={styles.primaryBtnText}>{weekSaving ? 'Guardando…' : `Guardar ${WEEK_FULL[currentDay]}`}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={weekSaving} onPress={resetDay} style={[styles.resetBtn, {marginLeft:8}]}>
                      <Text style={styles.resetBtnText}>Restablecer día</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>

            {/* Vacaciones / cierres por rango */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Vacaciones / Cierres</Text>
              <Text style={styles.cardDesc}>Bloquea fechas (formato <Text style={{fontWeight:'800'}}>DD-MM-YYYY</Text>) con mensaje opcional.</Text>

              {cvLoading ? <ActivityIndicator/> : closures.length===0 ? (
                <Text style={{color:'#666'}}>No hay cierres programados.</Text>
              ) : (
                <View style={{marginBottom:8}}>
                  {closures.map(cl=>(
                    <View key={cl.id} style={styles.closureRow}>
                      <View style={{flex:1}}>
                        <Text style={styles.closureDates}>
                          {new Date(cl.starts_on).toLocaleDateString('es-ES')} → {new Date(cl.ends_on).toLocaleDateString('es-ES')}
                        </Text>
                        {!!cl.message && <Text style={styles.closureMsg}>{cl.message}</Text>}
                      </View>
                      <TouchableOpacity onPress={()=>deleteClosure(cl.id)} style={styles.deleteBtn}>
                        <Feather name="trash-2" size={16} color="#fff"/>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.cvForm}>
                <TextInput placeholder="DD-MM-YYYY" value={cvStart} onChangeText={(t)=>setCvStart(formatDMYOnly(t))}
                  style={[styles.input,{minWidth:120}]} keyboardType={Platform.OS==='ios'?'number-pad':'numeric'} inputMode="numeric" maxLength={10} autoCapitalize="none"/>
                <Text style={{marginHorizontal:6,color:'#666'}}>→</Text>
                <TextInput placeholder="DD-MM-YYYY" value={cvEnd} onChangeText={(t)=>setCvEnd(formatDMYOnly(t))}
                  style={[styles.input,{minWidth:120}]} keyboardType={Platform.OS==='ios'?'number-pad':'numeric'} inputMode="numeric" maxLength={10} autoCapitalize="none"/>
              </View>
              <TextInput placeholder="Mensaje (opcional)" value={cvMsg} onChangeText={setCvMsg} style={[styles.input,{marginTop:8}]}/>
              <TouchableOpacity onPress={addClosure} disabled={cvLoading || !isDMY(cvStart) || !isDMY(cvEnd)} style={[styles.primaryBtn,{marginTop:8}, (cvLoading || !isDMY(cvStart) || !isDMY(cvEnd)) && {opacity:.6}]}>
                <Text style={styles.primaryBtnText}>{cvLoading ? 'Añadiendo…' : 'Añadir'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:{flex:1,backgroundColor:'#fff'},

  card:{backgroundColor:'#fafafa',borderRadius:14,padding:16,borderWidth:1,borderColor:'#eee',marginBottom:14},
  cardTitle:{fontSize:16,fontWeight:'800',marginBottom:6},
  cardDesc:{color:'#555',marginBottom:12},

  // Duración
  infoBox:{backgroundColor:'#fff',borderRadius:10,padding:10,borderWidth:1,borderColor:'#eee',marginBottom:12},
  infoLine:{fontSize:14,marginBottom:2},
  bold:{fontWeight:'800'},
  radioRow:{flexDirection:'row',gap:12,marginBottom:12},
  radioItem:{flexDirection:'row',alignItems:'center'},
  radioCircle:{width:20,height:20,borderRadius:12,borderWidth:2,borderColor:'#999',alignItems:'center',justifyContent:'center',marginRight:8},
  radioCircleChecked:{borderColor:'#111'},
  radioDot:{width:10,height:10,borderRadius:6,backgroundColor:'#111'},
  radioLabel:{fontSize:14,fontWeight:'700'},

  primaryBtn:{paddingVertical:12,borderRadius:10,backgroundColor:'#111',alignItems:'center'},
  primaryBtnText:{color:'#fff',fontWeight:'700'},

  // Semana
  dayRow:{flexDirection:'row',justifyContent:'space-between',marginBottom:10},
  dayChip:{paddingVertical:6,paddingHorizontal:10,borderRadius:10,backgroundColor:'#f2f2f2'},
  dayChipSel:{backgroundColor:'#111'},
  dayChipText:{color:'#333',fontWeight:'800'},
  dayChipTextSel:{color:'#fff',fontWeight:'800'},

  slotRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:'#fff',borderWidth:1,borderColor:'#eee',borderRadius:10,paddingVertical:10,paddingHorizontal:12,marginBottom:8},
  slotText:{fontWeight:'700'},
  deleteBtn:{backgroundColor:'#c62828',paddingHorizontal:10,paddingVertical:6,borderRadius:10},

  addRow:{flexDirection:'row',alignItems:'center',marginTop:6},
  input:{backgroundColor:'#fff',borderWidth:1,borderColor:'#eee',borderRadius:10,paddingHorizontal:10,paddingVertical:8,minWidth:80},
  addBtn:{marginLeft:8,backgroundColor:'#111',paddingHorizontal:12,paddingVertical:10,borderRadius:10},
  addBtnText:{color:'#fff',fontWeight:'700'},

  actionsRow:{flexDirection:'row',alignItems:'center',marginTop:10},
  resetBtn:{paddingVertical:12,paddingHorizontal:12,borderRadius:10,backgroundColor:'#eee'},
  resetBtnText:{color:'#333',fontWeight:'700'},

  // Vacaciones
  closureRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:'#fff',borderWidth:1,borderColor:'#eee',borderRadius:10,paddingVertical:10,paddingHorizontal:12,marginBottom:8},
  closureDates:{fontWeight:'800'},
  closureMsg:{color:'#555',marginTop:2},
  cvForm:{flexDirection:'row',alignItems:'center',marginTop:6},

  // Placeholders
  placeholderBox:{borderWidth:1,borderColor:'#ddd',borderStyle:'dashed',borderRadius:12,padding:16,alignItems:'center',justifyContent:'center'},
  placeholderText:{color:'#888'},
});
