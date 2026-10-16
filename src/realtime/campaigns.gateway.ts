import { Injectable } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/**
 * Replaces the prototype's "call renderAll() after every local mutation"
 * pattern with a real push channel: whenever a campaign's booked units (and
 * therefore its current price / units-to-next-slab) changes on the server,
 * every client viewing that campaign gets the update immediately instead of
 * polling or relying on their own optimistic state being correct.
 *
 * Room-per-campaign keeps broadcasts scoped — a busy campaign's updates
 * don't get pushed to clients looking at an unrelated one.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN?.split(',') ?? '*' }, namespace: 'campaigns' })
export class CampaignsGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('subscribe')
  onSubscribe(@MessageBody() campaignId: string, @ConnectedSocket() client: Socket) {
    client.join(roomFor(campaignId));
  }

  @SubscribeMessage('unsubscribe')
  onUnsubscribe(@MessageBody() campaignId: string, @ConnectedSocket() client: Socket) {
    client.leave(roomFor(campaignId));
  }

  /**
   * Partial on purpose: a mere reservation (checkout started, not yet paid)
   * only ever changes `unitsLeft`; `bookedUnits`/`currentPrice`/
   * `unitsToNextSlab`/`nextSlabPrice` are confirmed-sales numbers and only
   * change once an order is actually CONFIRMED (see
   * CampaignsService.broadcastState vs. reserveUnits). Clients should merge
   * whatever fields are present rather than assuming the full shape.
   */
  broadcastCampaignUpdate(
    campaignId: string,
    payload: Partial<{
      bookedUnits: number;
      currentPrice: number;
      unitsToNextSlab: number | null;
      nextSlabPrice: number | null;
      unitsLeft: number;
    }>,
  ) {
    this.server.to(roomFor(campaignId)).emit('campaign:update', { campaignId, ...payload });
  }
}

function roomFor(campaignId: string) {
  return `campaign:${campaignId}`;
}
