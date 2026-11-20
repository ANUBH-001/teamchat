import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../useTheme';

export function makeScreen(title: string) {
  return function Screen() {
    const t = useTheme();
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.background }}>
        <Text style={{ color: t.text, fontSize: 18 }}>{title}</Text>
      </View>
    );
  };
}
