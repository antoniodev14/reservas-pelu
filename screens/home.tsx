import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Image, Pressable, Modal,
  TouchableOpacity, ActivityIndicator, StyleSheet, Platform,
  KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useNavigation } from '@react-navigation/native';
import type { RootStackParamList } from '../App';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import HeaderBar from '../components/HeaderBar';


type Business = {
  id: string;
  name: string;
  cover_image_url: string | null;
  city: string | null;
  style: string | null;
};

export default function Home() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());

  const [loginVisible, setLoginVisible] = useState(false);
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [suggestions, setSuggestions] = useState<Business[]>([]);
  const [list, setList] = useState<Business[]>([]);
  const [loading, setLoading] = useState(false);

  const [fullName, setFullName] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) { setFullName(null); return; }
      const { data: p } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', uid)
        .maybeSingle();
      setFullName(p?.full_name ?? u.user?.email ?? null);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email ?? null;
      setSessionEmail(email);

      const uid = data.session?.user?.id;
      if (uid) {
        const { data: my } = await supabase.from('businesses').select('id').eq('owner_user_id', uid);
        setOwnedIds(new Set((my || []).map(x => x.id)));
      } else {
        setOwnedIds(new Set());
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, sess) => {
      const email = sess?.user?.email ?? null;
      setSessionEmail(email);
      const uid = sess?.user?.id;
      if (uid) {
        const { data: my } = await supabase.from('businesses').select('id').eq('owner_user_id', uid);
        setOwnedIds(new Set((my || []).map(x => x.id)));
      } else {
        setOwnedIds(new Set());
      }
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('businesses')
        .select('id,name,cover_image_url,city,style,is_active')
        .eq('is_active', true)
        .order('name', { ascending: true })
        .limit(50);
      setList((data as Business[]) || []);
      setLoading(false);
    })();
  }, []);

  const onChangeQuery = (t: string) => { setQuery(t); setShowSuggestions(true); };

  useEffect(() => {
    const q = query.trim();
    if (!showSuggestions || q.length < 2) { setSuggestions([]); return; }

    const timer = setTimeout(async () => {
      const { data: starts } = await supabase
        .from('businesses')
        .select('id,name,cover_image_url,city,style')
        .eq('is_active', true)
        .ilike('name', `${q}%`)
        .limit(8);

      let merged: Business[] = starts ?? [];

      if ((starts?.length ?? 0) < 8) {
        const { data: contains } = await supabase
          .from('businesses')
          .select('id,name,cover_image_url,city,style')
          .eq('is_active', true)
          .ilike('name', `%${q}%`)
          .limit(8);
        const ids = new Set(merged.map(b => b.id));
        for (const b of (contains ?? [])) {
          if (!ids.has((b as Business).id) && merged.length < 8) merged.push(b as Business);
        }
      }
      setSuggestions(merged);
    }, 200);

    return () => clearTimeout(timer);
  }, [query, showSuggestions]);

  const onLogin = async () => {
    setLoggingIn(true);
    setLoginError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) setLoginError(error.message);
    setLoggingIn(false);
    if (!error) setLoginVisible(false);
  };

  const openBusiness = (b: Business) => {
    navigation.navigate('BusinessDetail', { businessId: b.id, name: b.name });
  };

  const onPickSuggestion = (s: Business) => {
    setQuery(s.name);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    if (!showSuggestions) return list.filter(b => b.name.toLowerCase() === q);
    return list.filter(b => b.name.toLowerCase().includes(q));
  }, [list, query, showSuggestions]);

  const renderItem = ({ item }: { item: Business }) => {
    const isOwner = ownedIds.has(item.id);
    const initial = (item.name?.[0] || '?').toUpperCase();
    return (
      <Pressable onPress={() => openBusiness(item)} style={styles.card}>
        {item.cover_image_url ? (
          <Image source={{ uri: item.cover_image_url }} style={styles.cardImage} />
        ) : (
          <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{item.name}</Text>
          {!!item.style && <Text style={styles.cardStyle}>{item.style}</Text>}
          {!!item.city && <Text style={styles.cardCity}>{item.city}</Text>}
        </View>
        {isOwner ? (
          <Feather name="edit-3" size={20} color="#666" />
        ) : (
          <Text style={styles.chevron}>{'>'}</Text>
        )}
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 8) }]}>
      <HeaderBar
        title="Inicio"
        rightLabel={sessionEmail ? 'Salir' : 'Iniciar sesión'}
        greeting={fullName ?? undefined} 
        onRightPress={async () => {
          if (sessionEmail) {
            await supabase.auth.signOut();
          } else {
            setLoginVisible(true);
          }
        }}
      />

      <View style={styles.searchWrap}>
        <TextInput
          placeholder="Buscar peluquería o zona…"
          value={query}
          onChangeText={onChangeQuery}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {showSuggestions && query.trim().length >= 2 && suggestions.length > 0 && (
          <View style={styles.suggestBox}>
            {suggestions.map((s) => (
              <Pressable key={s.id} onPress={() => onPickSuggestion(s)} style={styles.suggestItem}>
                <Text style={styles.suggestText}>{s.name}</Text>
                {!!s.city && <Text style={styles.suggestCity}>{s.city}</Text>}
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text style={{ marginTop: 8 }}>Cargando peluquerías…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={
            <View style={{ padding: 16 }}>
              <Text>No encontramos resultados. Prueba con “Pelu”, “Barbería”…</Text>
            </View>
          }
        />
      )}

      <Modal visible={loginVisible} animationType="slide" transparent onRequestClose={() => setLoginVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
          style={styles.modalAvoider}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalBackdrop}>
              <View style={[styles.modalCard, { paddingBottom: 10 + Math.max(insets.bottom, 10) }]}>
                <Text style={styles.modalTitle}>Acceder</Text>
                <TextInput placeholder="Correo" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} />
                <TextInput placeholder="Contraseña" value={pass} onChangeText={setPass} secureTextEntry style={styles.input} />
                {!!loginError && <Text style={styles.errorText}>{loginError}</Text>}
                <TouchableOpacity disabled={loggingIn} onPress={onLogin} style={styles.primaryBtn}>
                  <Text style={styles.primaryBtnText}>{loggingIn ? 'Accediendo…' : 'Acceder'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setLoginVisible(false)} style={styles.linkBtn}>
                  <Text style={styles.linkText}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  searchWrap: { paddingHorizontal: 16, marginBottom: 8 },
  searchInput: { backgroundColor: '#f2f2f2', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },

  suggestBox: {
    backgroundColor: '#fff', borderRadius: 10, marginTop: 6,
    elevation: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6
  },
  suggestItem: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' },
  suggestText: { fontSize: 14, fontWeight: '600' },
  suggestCity: { fontSize: 12, color: '#666', marginTop: 2 },

  loading: { padding: 16, alignItems: 'center' },

  card: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, marginHorizontal: 16, marginTop: 10,
    borderRadius: 12, backgroundColor: '#fafafa'
  },
  cardImage: { width: 56, height: 56, borderRadius: 10, marginRight: 12, backgroundColor: '#ddd' },
  avatar: { width: 56, height: 56, borderRadius: 10, marginRight: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e6e6e6' },
  avatarText: { fontSize: 20, fontWeight: '700', color: '#555' },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardStyle: { fontSize: 13, color: '#444', marginTop: 2 },
  cardCity: { fontSize: 12, color: '#666', marginTop: 2 },
  chevron: { fontSize: 20, fontWeight: '700', color: '#999', marginLeft: 8 },

  // Modal + teclado
  modalAvoider: { flex: 1 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 420, borderRadius: 16, backgroundColor: '#fff', padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  input: { backgroundColor: '#f3f3f3', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginVertical: 6 },
  primaryBtn: { marginTop: 8, paddingVertical: 12, borderRadius: 10, backgroundColor: '#111', alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  linkBtn: { marginTop: 8, alignItems: 'center' },
  errorText: { color: '#c00', marginTop: 6 },
  linkText: { color: '#333' },
});
