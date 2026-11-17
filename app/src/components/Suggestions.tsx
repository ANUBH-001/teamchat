import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Theme } from '../theme';

export type Suggestion = { key: string; title: string; sub?: string; left?: React.ReactNode; onPress: () => void };

// Small card above the composer: slash commands, my open tasks, @mention members.
export default function Suggestions({ items, t }: { items: Suggestion[]; t: Theme }) {
  if (!items.length) return null;
  return (
    <View style={{ marginHorizontal: 8, marginBottom: 4, backgroundColor: t.card, borderRadius: 14, maxHeight: 232, overflow: 'hidden', elevation: 3 }}>
      <ScrollView keyboardShouldPersistTaps="always">
        {items.map((s) => (
          <Pressable
            key={s.key}
            onPress={s.onPress}
            android_ripple={{ color: t.border }}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 14, paddingVertical: 6 }}
          >
            {s.left}
            <View style={{ flex: 1, marginLeft: s.left ? 10 : 0 }}>
              <Text numberOfLines={1} style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>{s.title}</Text>
              {!!s.sub && <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 12 }}>{s.sub}</Text>}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
