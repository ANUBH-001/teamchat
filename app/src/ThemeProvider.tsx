// Round 4: ThemeProvider. Choice System | Light | Dark lives in prefs.ts (AsyncStorage). useTheme() (useTheme.ts)
// returns the `light` / `dark` object itself (so `t === dark` checks keep working).
import React, { createContext } from 'react';
import { useColorScheme } from 'react-native';
import { light, dark, Theme } from './theme';
import { usePrefs } from './prefs';

export const ThemeContext = createContext<Theme>(light);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const sys = useColorScheme();
  const { theme } = usePrefs();
  const t = theme === 'dark' || (theme === 'system' && sys === 'dark') ? dark : light;
  return <ThemeContext.Provider value={t}>{children}</ThemeContext.Provider>;
}
