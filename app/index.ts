import { registerRootComponent } from 'expo';
import './src/background'; // registers the foreground-service headless task before the app starts
import App from './App';

registerRootComponent(App);
