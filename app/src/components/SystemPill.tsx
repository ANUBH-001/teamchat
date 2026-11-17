import React from 'react';
import { Text, View } from 'react-native';
import { Theme } from '../theme';

// type 'system' message (e.g. "Rishit added Anubhav") as a centered grey pill.
function SystemPillBase({ text, t }: { text: string; t: Theme }) {
  return (
    <View style={{ alignItems: 'center', marginVertical: 6, paddingHorizontal: 24 }}>
      <Text style={{ backgroundColor: t.card, color: t.subtext, fontSize: 12, textAlign: 'center', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' }}>
        {text}
      </Text>
    </View>
  );
}
export default React.memo(SystemPillBase);
