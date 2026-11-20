import { useContext } from 'react';
import { ThemeContext } from './ThemeProvider';
import { Theme } from './theme';

// Round 4: reads the ThemeProvider (System | Light | Dark choice) instead of useColorScheme directly.
export const useTheme = (): Theme => useContext(ThemeContext);
