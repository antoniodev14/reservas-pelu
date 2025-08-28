// components/ReserveModal.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Platform,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  SafeAreaView,
  Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

type Props = {
  visible: boolean;
  businessId?: string;
  onClose: () => void;
  onConfirm: (form: { name: string; phone: string }, serviceId: string) => void;
};

type Service = {
  id: string;
  name: string;
  price_cents: number;
  duration_minutes: number;
  sort_order: number;
};

export default function ReserveModal({ visible, businessId, onClose, onConfirm }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // sub-modal: lista de servicios
  const [selectOpen, setSelectOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    // reset inputs cada vez que se abre
    setName('');
    setPhone('');
  }, [visible]);

  useEffect(() => {
    if (!visible || !businessId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc('public_list_services', { p_business: businessId });
      setLoading(false);
      if (error) {
        Alert.alert('Error', 'No se pudieron cargar los servicios');
        setServices([]);
        setSelected(null);
        return;
      }
      const arr = (data as Service[]) ?? [];
      setServices(arr);
      setSelected(arr.length > 0 ? arr[0].id : null);
    })();
  }, [visible, businessId]);

  const selectedObj = useMemo(() => services.find((s) => s.id === selected) ?? null, [services, selected]);
  const euro = (c: number) => (c / 100).toFixed(2).replace('.', ',');

  const confirm = () => {
    if (!selected) {
      Alert.alert('Falta el servicio', 'Selecciona un servicio antes de confirmar.');
      return;
    }
    onConfirm({ name: name.trim(), phone: phone.trim() }, selected);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Backdrop: tocar fuera cierra la modal */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Card: detener propagación para no cerrar al tocar dentro */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
          style={{ width: '100%' }}
        >
          <Pressable onPress={() => {}} style={styles.card}>
            <ScrollView contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.title}>Reservar cita</Text>

              {/* Campo “select” simple con flecha */}
              <Text style={styles.label}>Servicio</Text>
              {loading ? (
                <ActivityIndicator />
              ) : services.length === 0 ? (
                <Text style={{ color: '#666' }}>Este negocio aún no tiene servicios.</Text>
              ) : (
                <TouchableOpacity
                  onPress={() => setSelectOpen(true)}
                  activeOpacity={0.8}
                  style={styles.selectBox}
                >
                  <Text style={styles.selectText}>
                    {selectedObj ? selectedObj.name : 'Selecciona un servicio'}
                  </Text>
                  <Feather name="chevron-down" size={18} color="#111" />
                </TouchableOpacity>
              )}

              {/* Datos cliente */}
              <Text style={[styles.label, { marginTop: 10 }]}>Nombre</Text>
              <TextInput value={name} onChangeText={setName} placeholder="Tu nombre" style={styles.input} />

              <Text style={[styles.label, { marginTop: 8 }]}>Teléfono</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="Tu teléfono"
                style={styles.input}
                keyboardType={Platform.OS === 'ios' ? 'number-pad' : 'phone-pad'}
              />

              {/* Acciones */}
              <View style={{ flexDirection: 'row', marginTop: 12 }}>
                <TouchableOpacity onPress={confirm} style={[styles.primaryBtn, { flex: 1 }]}>
                  <Text style={styles.primaryBtnText}>Confirmar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onClose} style={[styles.resetBtn, { marginLeft: 8 }]}>
                  <Text style={styles.resetBtnText}>Cerrar</Text>
                </TouchableOpacity>
              </View>

              {/* Pie: info del servicio elegido */}
              {selectedObj && (
                <Text style={{ marginTop: 8, color: '#555' }}>
                  Duración: {selectedObj.duration_minutes} min · Precio: {euro(selectedObj.price_cents)} €
                </Text>
              )}
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>

      {/* Sub-Modal: lista de servicios (tocar fuera cierra) */}
      <Modal visible={selectOpen} transparent animationType="fade" onRequestClose={() => setSelectOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSelectOpen(false)}>
          <Pressable onPress={() => {}} style={styles.sheet}>
            <Text style={styles.sheetTitle}>Selecciona servicio</Text>
            <ScrollView>
              {services.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => {
                    setSelected(s.id);
                    setSelectOpen(false);
                  }}
                  style={styles.sheetItem}
                >
                  <Text style={styles.sheetItemText}>{s.name}</Text>
                  {selected === s.id && <Feather name="check" size={16} color="#111" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#eee',
    width: '100%',
    maxHeight: '85%',
  },
  title: { fontSize: 16, fontWeight: '900', marginBottom: 8, color: '#111' },
  label: { fontWeight: '800', color: '#111', marginTop: 4 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginTop: 4,
  },

  // Select “normal”
  selectBox: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectText: { color: '#111', fontWeight: '700' },

  primaryBtn: { paddingVertical: 12, borderRadius: 10, backgroundColor: '#111', alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  resetBtn: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#eee' },
  resetBtnText: { color: '#333', fontWeight: '700' },

  // Sheet (lista de servicios)
  sheet: {
    width: '100%',
    maxHeight: '70%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#eee',
  },
  sheetTitle: { fontSize: 16, fontWeight: '900', marginBottom: 8, color: '#111' },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
    justifyContent: 'space-between',
  },
  sheetItemText: { fontWeight: '700', color: '#111' },
});
