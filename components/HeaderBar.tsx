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
};

export default function HeaderBar({
  title,
  leftLabel,
  leftIcon,
  onLeftPress,
  rightLabel,
  onRightPress,
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
      <Text numberOfLines={1} style={styles.title}>{title}</Text>

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
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
