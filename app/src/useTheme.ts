import { useColorScheme } from 'react-native';
import { light, dark } from './theme';

export const useTheme = () => (useColorScheme() === 'dark' ? dark : light);
