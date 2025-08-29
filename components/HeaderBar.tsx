import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

type Props = {
  title: string;

  leftLabel?: string;
  leftIcon?: keyof typeof Feather.glyphMap;
  onLeftPress?: () => void;

  rightLabel?: string;
  onRightPress?: () => void;

  greeting?: string; // 🆕
};

export default function HeaderBar({
  title,
  leftLabel,
  leftIcon,
  onLeftPress,
  rightLabel,
  onRightPress,
  greeting
}: Props) {
  return (
    <View style={styles.wrap}>
      {/* Botón izquierda (opcional) */}
      {leftLabel || leftIcon ? (
        <TouchableOpacity onPress={onLeftPress} style={styles.actionBtnGhost}>
          {leftIcon ? <Feather name={leftIcon} size={16} color="#111" /> : null}
          {leftLabel ? <Text style={styles.actionGhostText}>{leftLabel}</Text> : null}
        </TouchableOpacity>
      ) : null}

      {/* Título pegado a la izquierda */}
      <View style={{ flex:1 }}>
        <Text style={styles.title}>{title}</Text>
        {greeting ? <Text style={styles.greeting}>Bienvenido, {greeting}</Text> : null}
      </View>

      {/* Botón derecha solo texto (opcional) */}
      {rightLabel ? (
        <TouchableOpacity onPress={onRightPress} style={styles.actionBtnSolid}>
          <Text style={styles.actionSolidText}>{rightLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection:'row',
    alignItems:'center',
    justifyContent:'space-between',
    paddingHorizontal:16,
    paddingVertical:12,
    borderBottomWidth:1,
    borderBottomColor:'#eee',
    backgroundColor:'#fff'
  },

  title: {
      fontSize: 20,
      fontWeight: '800',
      marginLeft: 5,
      flex: 1,        // ocupa espacio intermedio
      textAlign: 'left', // alineado a la izquierda
    },

  actionBtnSolid: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 84,
    justifyContent: 'center',
  },
  actionSolidText: { color: '#fff', fontWeight: '700' },
  greeting:{ marginTop:2, color:'#444', fontWeight:'700', fontSize:13 },

  actionBtnGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e6e6e6',
    minWidth: 84,
    justifyContent: 'center',
  },
  actionGhostText: { color: '#111', fontWeight: '700', marginLeft: 6 },
});
