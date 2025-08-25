import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, KeyboardAvoidingView
} from 'react-native';

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (payload: { name: string; phone: string }) => void;
};

export default function ReserveModal({ visible, onClose, onConfirm }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const canConfirm = name.trim().length >= 2 && phone.trim().length >= 6;

  const submit = () => {
    if (!canConfirm) return;
    onConfirm({ name: name.trim(), phone: phone.trim() });
    setName('');
    setPhone('');
  };

  const close = () => {
    setName('');
    setPhone('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <View style={styles.box}>
          <Text style={styles.title}>Reservar cita</Text>
          <Text style={styles.desc}>Introduce tu nombre y teléfono para confirmar la solicitud.</Text>

          <TextInput
            placeholder="Nombre"
            value={name}
            onChangeText={setName}
            style={styles.input}
            autoCapitalize="words"
            returnKeyType="next"
          />
          <TextInput
            placeholder="Teléfono"
            value={phone}
            onChangeText={(t) => setPhone(t.replace(/[^0-9+\s]/g, ''))}
            style={styles.input}
            keyboardType={Platform.OS === 'ios' ? 'number-pad' : 'phone-pad'}
          />

          <View style={styles.row}>
            <TouchableOpacity onPress={close} style={[styles.btn, styles.btnGhost]}>
              <Text style={[styles.btnText, { color: '#111' }]}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={!canConfirm} onPress={submit} style={[styles.btn, !canConfirm && { opacity: 0.6 }]}>
              <Text style={styles.btnText}>Reservar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  box: { backgroundColor: '#fff', width: '100%', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#eee' },
  title: { fontSize: 16, fontWeight: '800', marginBottom: 6 },
  desc: { color: '#555', marginBottom: 12 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
  btn: { backgroundColor: '#111', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, marginLeft: 8 },
  btnGhost: { backgroundColor: '#eee' },
  btnText: { color: '#fff', fontWeight: '700' },
});
