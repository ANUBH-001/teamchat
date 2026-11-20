// Round 4: disabled (simple create->done): no longer rendered anywhere (Tasks tab is Mine / Team / Done now). File kept.
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../useTheme';
import { STEPS, STATUS_COLOR, STATUS_LABEL, StepStatus } from '../taskTypes';

// The 6 status steps as a row of tappable pills (horizontal scroll unless wrap). value = current step (highlighted).
export default function StatusChips({ value, onPick, disabled, wrap, small }: {
  value: string | null | undefined; onPick: (s: StepStatus) => void; disabled?: boolean; wrap?: boolean; small?: boolean;
}) {
  const t = useTheme();
  const chips = STEPS.map((s) => {
    const on = value === s;
    const c = STATUS_COLOR[s];
    return (
      <Pressable
        key={s} disabled={disabled || on} onPress={() => onPick(s)} hitSlop={4}
        style={{
          minHeight: small ? 30 : 36, paddingHorizontal: small ? 10 : 12, borderRadius: 18, marginRight: 6, marginBottom: wrap ? 6 : 0,
          justifyContent: 'center', backgroundColor: on ? c : t.card, borderWidth: 1, borderColor: on ? c : t.border, opacity: disabled && !on ? 0.5 : 1,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {!on && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c, marginRight: 6 }} />}
          <Text style={{ color: on ? '#fff' : t.text, fontSize: small ? 12 : 13, fontWeight: on ? '700' : '500' }}>{STATUS_LABEL[s]}</Text>
        </View>
      </Pressable>
    );
  });
  if (wrap) return <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{chips}</View>;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">{chips}</ScrollView>;
}
