import 'dotenv/config';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { app } from './app';
import { setIo } from './lib/io';
import { registerLocationHandlers } from './sockets/locationHandler';
import { logger } from './lib/logger';

const httpServer = createServer(app);
const corsOrigin = process.env.APP_BASE_URL || 'http://localhost:3000';

// Not exported: all socket access goes through lib/io (setIo/getIo) so route
// modules never import the server entrypoint (which would start listening).
const io = new SocketServer(httpServer, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling'],
});
setIo(io);
registerLocationHandlers(io);

const PORT = parseInt(process.env.PORT || '3001', 10);
httpServer.listen(PORT, () => {
  logger.info(`MidTransport API running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export { httpServer };
