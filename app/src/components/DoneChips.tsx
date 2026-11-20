import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../useTheme';
import { StepStatus } from '../taskTypes';

// Round 4: replaces the 6-step StatusChips (simple create->done). Two choices: Not done / Done. Same props as StatusChips.
export default function DoneChips({ value, onPick, disabled, small }: {
  value: string | null | undefined; onPick: (s: StepStatus) => void; disabled?: boolean; wrap?: boolean; small?: boolean;
}) {
  const t = useTheme();
  const cur = value === 'done' ? 'done' : 'todo';
  return (
    <View style={{ flexDirection: 'row' }}>
      {([['todo', 'Not done'], ['done', 'Done']] as const).map(([k, label]) => {
        const on = cur === k;
        return (
          <Pressable
            key={k} disabled={disabled || on} onPress={() => onPick(k)} hitSlop={4}
            style={{
              minHeight: small ? 32 : 40, paddingHorizontal: 18, borderRadius: 20, marginRight: 8, justifyContent: 'center',
              backgroundColor: on ? t.accent : t.card, borderWidth: 1, borderColor: on ? t.accent : t.border, opacity: disabled && !on ? 0.5 : 1,
            }}
          >
            <Text style={{ color: on ? t.onAccent : t.text, fontSize: small ? 12 : 14, fontWeight: on ? '700' : '500' }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
