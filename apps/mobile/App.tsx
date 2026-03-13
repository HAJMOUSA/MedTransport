import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';

import { useAuthStore } from './src/hooks/useAuth';
import { LoginScreen } from './src/screens/LoginScreen';
import { TripList } from './src/screens/TripList';
import { ActiveTrip } from './src/screens/ActiveTrip';
import { OTPEntry } from './src/screens/OTPEntry';

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  ActiveTrip: { tripId: number };
  OTPEntry: { tripId: number; eventType: 'pickup' | 'dropoff' };
};

const Stack = createStackNavigator<RootStackParamList>();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function RootNavigator() {
  const { user, isLoading, loadFromStorage } = useAuthStore();
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    loadFromStorage().finally(() => setBootstrapped(true));
  }, [loadFromStorage]);

  if (!bootstrapped || isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eff6ff' }}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: '#f9fafb' },
        }}
      >
        {user ? (
          <>
            <Stack.Screen name="Main" component={TripList} />
            <Stack.Screen
              name="ActiveTrip"
              component={ActiveTrip}
              options={{ presentation: 'card' }}
            />
            <Stack.Screen
              name="OTPEntry"
              component={OTPEntry}
              options={{ presentation: 'modal' }}
            />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <RootNavigator />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
