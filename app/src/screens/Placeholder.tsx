import React from 'react';
import { View, Text, useColorScheme } from 'react-native';
import { light, dark } from '../theme';

export function makeScreen(title: string) {
  return function Screen() {
    const t = useColorScheme() === 'dark' ? dark : light;
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.background }}>
        <Text style={{ color: t.text, fontSize: 18 }}>{title}</Text>
      </View>
    );
  };
}
