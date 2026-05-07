import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { env } from './env.validation';
import { logger } from '../logger';

const log = logger.child({ module: 'socket.io' });

export class SocketService {
  private static io: SocketIOServer;

  /**
   * Initializes the Socket.IO server, attaching it to the provided HTTP Server.
   */
  public static initialize(server: HttpServer): void {
    if (this.io) {
      log.warn('SocketService is already initialized.');
      return;
    }

    this.io = new SocketIOServer(server, {
      cors: {
        origin: env.NODE_ENV === 'development' ? '*' : env.CORS_ALLOWED_ORIGINS?.split(',') || [],
        methods: ['GET', 'POST'],
        credentials: true,
      },
    });

    // Basic frontend authentication layer expecting a token payload
    // A production system will naturally decode JWT here. We're extracting from auth payload directly.
    this.io.use((socket: Socket, next) => {
      const userId = socket.handshake.auth.userId || socket.handshake.query.userId;
      if (!userId) {
        return next(new Error('Authentication error: userId is missing.'));
      }
      
      // Store user id in socket context
      socket.data.userId = userId;
      next();
    });

    this.io.on('connection', (socket: Socket) => {
      const userId = socket.data.userId;
      
      // Join a personal room
      const roomName = `user_${userId}`;
      socket.join(roomName);
      log.info(`Socket connected and joined room: ${roomName}`, { socketId: socket.id });

      socket.on('disconnect', () => {
        log.debug(`Socket disconnected: ${socket.id}`);
      });
    });

    log.info('Socket.IO server initialized successfully.');
  }

  /**
   * Retrieve the active Socket IO server instance.
   */
  public static getIO(): SocketIOServer {
    if (!this.io) {
      throw new Error('SocketService is not initialized. Call initialize(server) first.');
    }
    return this.io;
  }

  /**
   * Pushes a real-time event explicitly to a user's personal room.
   */
  public static emitToUser(userId: string, event: string, payload: any): void {
    if (!this.io) return; // Fail gracefully if not hooked up yet
    this.io.to(`user_${userId}`).emit(event, payload);
    log.debug(`Emitted event ${event} to user_${userId}`);
  }
}
