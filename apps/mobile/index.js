import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import App from './App';

// The app uses a manual App.tsx root + React Navigation (not expo-router),
// so register App as the root component.
registerRootComponent(App);
