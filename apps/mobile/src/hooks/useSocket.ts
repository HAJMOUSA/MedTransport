import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const API_URL =
  Constants.expoConfig?.extra?.apiUrl ??
  process.env.EXPO_PUBLIC_API_URL ??
  'http://localhost:3001';

let globalSocket: Socket | null = null;

export function useSocket(): React.MutableRefObject<Socket | null> {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (globalSocket?.connected) {
      socketRef.current = globalSocket;
      return;
    }

    (async () => {
      const token = await SecureStore.getItemAsync('accessToken');
      globalSocket = io(API_URL, {
        auth: { token },
        transports: ['websocket'],
        reconnectionDelay: 1000,
        reconnectionAttempts: 10,
      });
      socketRef.current = globalSocket;
    })();

    return () => {
      // Keep socket alive across component re-mounts
    };
  }, []);

  return socketRef;
}
