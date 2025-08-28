// screens/OwnerServices.tsx
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, Platform, Switch
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

type Service = {
  id: string;
  name: string;
  price_cents: number;
  duration_minutes: number;
  sort_order: number;
  active: boolean;
};

const DURATION_OPTIONS = [
  { label: '10 min', value: 10 },
  { label: '20 min', value: 20 },
  { label: '30 min', value: 30 },
  { label: '40 min', value: 40 },
  { label: '1 h', value: 60 },
  { label: '1 h 30', value: 90 },
  { label: '2 h', value: 120 },
];
type DurValue = number

export default function OwnerServices({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [bizDefault, setBizDefault] = useState<number>(30);

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Service[]>([]);
  const [saving, setSaving] = useState(false);

  // form
  const [name, setName] = useState('');
  const [price, setPrice] = useState(''); // €
  const [durSel, setDurSel] = useState<DurValue>(10);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [setAsDefault, setSetAsDefault] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id;
      if (!uid) { setLoading(false); return; }

      const { data: biz, error } = await supabase
        .from('businesses')
        .select('id, name, default_duration_minutes')
        .eq('owner_user_id', uid)
        .maybeSingle();

      if (error || !biz) { Alert.alert('Error', 'No se encontró tu negocio'); setLoading(false); return; }

      navigation.setOptions({ title: `Servicios de ${biz.name ?? ''}`.trim() });

      setBusinessId(biz.id);
      setBizDefault(biz.default_duration_minutes ?? 30);
      await reload(biz.id);
      setLoading(false);
    })();
  }, []);

  const reload = async (bid: string) => {
    const { data, error } = await supabase.rpc('owner_list_services', { p_business: bid });
    if (error) { Alert.alert('Error', 'No se pudieron cargar los servicios'); setItems([]); return; }
    setItems((data as Service[]) ?? []);
  };

  const euroToCents = (s: string) => {
    const v = parseFloat((s || '0').replace(',', '.'));
    return Math.round((isNaN(v) ? 0 : v) * 100);
  };
  const centsToEuro = (c: number) => (c / 100).toFixed(2).replace('.', ',');

  const startEdit = (svc: Service) => {
    setEditingId(svc.id);
    setName(svc.name);
    setPrice(centsToEuro(svc.price_cents));
    setDurSel((svc.duration_minutes === bizDefault ? 'default' : (svc.duration_minutes as any)));
  };
  const resetForm = () => {
    setEditingId(null);
    setName('');
    setPrice('');
    setDurSel(10);
  };

  const save = async () => {
    if (!businessId) return;
    const payload = {
      business_id: businessId,
      id: editingId,
      name: name.trim(),
      price_cents: euroToCents(price),
      duration_minutes: durSel,
      sort_order: 0,
      active: true,
    };
    if (!payload.name || payload.price_cents < 0) { Alert.alert('Faltan datos'); return; }
    setSaving(true);
    const { error } = await supabase.rpc('owner_upsert_service_json', { payload });
    if (error) {
      setSaving(false);
      Alert.alert('Error', error.message ?? 'No se pudo guardar');
      return;
    }
    setSaving(false);
    resetForm();
    reload(businessId);
  };

  const remove = async (id: string) => {
    if (!businessId) return;
    Alert.alert('Eliminar', '¿Eliminar este servicio?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('owner_delete_service', { p_business: businessId, p_id: id });
          if (error) {
            Alert.alert('Error', error.message ?? 'No se pudo eliminar');
            return;
          }
          reload(businessId);
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 8) }]}>
      {loading ? (
        <View style={{ padding: 16 }}><ActivityIndicator /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{editingId ? 'Editar servicio' : 'Nuevo servicio'}</Text>

            <TextInput
              placeholder="Nombre (p.ej. Corte + Barba)"
              value={name}
              onChangeText={setName}
              style={styles.input}
            />

            <TextInput
              placeholder="Precio (€)"
              value={price}
              onChangeText={setPrice}
              keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
              style={[styles.input, { marginTop: 8 }]}
            />

            <Text style={[styles.label, { marginTop: 10 }]}>Duración</Text>
            <View style={styles.selectRow}>
              {DURATION_OPTIONS.map((opt) => {
                const sel = durSel === opt.value;
                return (
                  <TouchableOpacity
                    key={String(opt.value)}
                    onPress={() => setDurSel(opt.value)}
                    style={[styles.selectChip, sel && styles.selectChipSel]}
                  >
                    <Text style={[styles.selectChipText, sel && styles.selectChipTextSel]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', marginTop: 10 }}>
              <TouchableOpacity onPress={save} disabled={saving} style={[styles.primaryBtn, { flex: 1 }, saving && { opacity: 0.6 }]}>
                <Text style={styles.primaryBtnText}>{saving ? 'Guardando…' : (editingId ? 'Guardar cambios' : 'Añadir servicio')}</Text>
              </TouchableOpacity>
              {editingId && (
                <TouchableOpacity onPress={resetForm} style={[styles.resetBtn, { marginLeft: 8 }]}>
                  <Text style={styles.resetBtnText}>Cancelar</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Lista */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Servicios</Text>
            {items.length === 0 ? (
              <Text style={{ color: '#666' }}>Aún no has añadido servicios.</Text>
            ) : (
              <View>
                {items.map((svc) => (
                  <View key={svc.id} style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{svc.name}</Text>
                      <Text style={styles.rowSub}>
                        {(svc.price_cents / 100).toFixed(2).replace('.', ',')} € · {svc.duration_minutes} min
                        {!svc.active ? ' · inactivo' : ''}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => remove(svc.id)} style={[styles.iconBtn, { backgroundColor: '#c62828', marginLeft: 8 }]}>
                      <Feather name="trash-2" size={16} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => {
                      setEditingId(svc.id);
                      setName(svc.name);
                      setPrice((svc.price_cents / 100).toFixed(2).replace('.', ','));
                      setDurSel(svc.duration_minutes);
                    }} style={[styles.iconBtn, { backgroundColor: '#111', marginLeft: 8 }]}>
                      <Feather name="edit-2" size={16} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  card: { backgroundColor: '#fafafa', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#eee', marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10 },
  label: { fontWeight: '800', color: '#111' },
  selectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  selectChip: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#f1f1f1' },
  selectChipSel: { backgroundColor: '#111' },
  selectChipText: { color: '#333', fontWeight: '800' },
  selectChipTextSel: { color: '#fff' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  switchLabel: { color: '#111', fontWeight: '700', flex: 1, marginRight: 12 },
  primaryBtn: { paddingVertical: 12, borderRadius: 10, backgroundColor: '#111', alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  resetBtn: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#eee' },
  resetBtnText: { color: '#333', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8 },
  rowTitle: { fontWeight: '800' },
  rowSub: { color: '#555', marginTop: 2 },
  iconBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, minWidth: 36, alignItems: 'center', justifyContent: 'center' },
});
