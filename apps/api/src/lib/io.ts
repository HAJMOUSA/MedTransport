import type { Server } from 'socket.io';

let ioInstance: Server | null = null;

export function setIo(io: Server): void { ioInstance = io; }

export function getIo(): Server {
  if (!ioInstance) throw new Error('Socket.io not initialized');
  return ioInstance;
}
