import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../useTheme';

// Bottom sheet shell + a standard action row, used by the message menu and chat-row menu.
export default function Sheet({ visible, onClose, title, children }: {
  visible: boolean; onClose: () => void; title?: string; children: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <Pressable
          onPress={() => {}}
          style={{ backgroundColor: t.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8, paddingBottom: insets.bottom + 8, maxHeight: '85%' }}
        >
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: t.border, marginBottom: 8 }} />
          {!!title && (
            <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 13, paddingHorizontal: 20, paddingBottom: 8 }}>{title}</Text>
          )}
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function SheetRow({ icon, label, onPress, danger }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: t.border }}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 20 }}
    >
      <Ionicons name={icon} size={22} color={danger ? t.danger : t.subtext} />
      <Text style={{ color: danger ? t.danger : t.text, fontSize: 16, marginLeft: 16 }}>{label}</Text>
    </Pressable>
  );
}
