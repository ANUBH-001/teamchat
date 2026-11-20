import React from 'react';
import { View, Text } from 'react-native';
import { colorFor } from '../theme';
import { Image } from 'expo-image';
import { useUser } from '../userStore';
import { mediaCacheKey, useMediaSrc } from '../media';

export function initials(name: string) {
  const first = (w?: string) => Array.from(w ?? '').find((c) => /[\p{L}\p{N}]/u.test(c)) ?? '';
  const p = name.trim().split(/\s+/).filter((w) => first(w));
  return ((first(p[0]) || '?') + (p.length > 1 ? first(p[p.length - 1]) : '')).toUpperCase();
}

// id = color seed (a user id or a chat id). userId = the person shown (emoji avatar from the user store, live).
// emoji = explicit emoji (e.g. a payload snapshot) when no userId is known.
function AvatarBase({ name, id, size = 48, userId, emoji }: { name: string; id: number; size?: number; userId?: number | null; emoji?: string | null }) {
  const u = useUser(userId || null);
  const e = (u && u.avatarEmoji) || emoji || null;
  const label = (u && u.name) || name;
  const photo = useMediaSrc((u && u.avatarUrl) || null); // Round 4: DP photo wins over emoji / initials
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2,
        overflow: 'hidden', backgroundColor: photo ? 'transparent' : e ? colorFor(userId || id) + '33' : colorFor(userId || id), alignItems: 'center', justifyContent: 'center',
      }}
    >
      {photo
        ? <Image source={{ uri: photo, cacheKey: mediaCacheKey(u && u.avatarUrl) }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />
        : e
        ? <Text style={{ fontSize: size * 0.55 }}>{e}</Text>
        : <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: size * 0.38 }}>{initials(label)}</Text>}
    </View>
  );
}

export default React.memo(AvatarBase);

// Up to `max` small overlapping avatars (+N) for a task's people.
export function AvatarStack({ people, size = 22, max = 3 }: { people: { id: number; name: string; avatarEmoji?: string | null }[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  const more = people.length - shown.length;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {shown.map((p, i) => (
        <View key={p.id} style={{ marginLeft: i ? -size * 0.3 : 0, borderRadius: size, borderWidth: 1.5, borderColor: '#FFFFFF' }}>
          <AvatarBase name={p.name} id={p.id} userId={p.id} emoji={p.avatarEmoji || null} size={size} />
        </View>
      ))}
      {more > 0 && <Text style={{ fontSize: 11, color: '#9590B5', marginLeft: 4 }}>+{more}</Text>}
    </View>
  );
}
