import { Injectable } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../auth/jwt-payload';

/**
 * Per-user room, same shape as realtime/campaigns.gateway.ts's
 * room-per-campaign pattern — except notifications are private, so (unlike
 * the campaign gateway, which lets a client join any campaign room freely
 * since campaign updates are public data) a client here is auto-joined to
 * ITS OWN room based on the JWT it connects with, never a client-supplied id.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN?.split(',') ?? '*' }, namespace: 'notifications' })
export class NotificationsGateway implements OnGatewayConnection {
  constructor(private readonly jwt: JwtService) {}

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    const token = (client.handshake.auth?.token ?? client.handshake.query?.token) as string | undefined;
    try {
      if (!token) throw new Error('missing token');
      const payload = this.jwt.verify<JwtPayload>(token);
      client.join(roomFor(payload.sub));
    } catch {
      client.disconnect();
    }
  }

  notifyUser(userId: string, notification: { id: string; type: string; title: string; body: string; createdAt: Date }) {
    this.server.to(roomFor(userId)).emit('notification:new', notification);
  }
}

function roomFor(userId: string) {
  return `user:${userId}`;
}
