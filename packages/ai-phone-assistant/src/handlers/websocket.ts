import type { Context } from 'hono';
import { upgradeWebSocket } from 'hono/cloudflare-workers';
import { TwilioService } from '../services/twilio';
import { EnvironmentStore } from '../stores/environment';
import type { Env, TwilioMediaEvent } from '../types';

export const createMediaStreamHandler = upgradeWebSocket(
  (c: Context<{ Bindings: Env }>) => {
    console.log('WebSocket connection established');

    EnvironmentStore.initialize(c.env);
    let twilioService: TwilioService = null;

    return {
      onMessage: (event: MessageEvent, ws: any) => {
        if (!twilioService) {
          twilioService = new TwilioService(ws);
        }

        try {
          const data: TwilioMediaEvent = JSON.parse(event.data as string);

          switch (data.event) {
            case 'media':
              if (data.media) {
                twilioService.sendAudioToOpenAI(data.media);
              }
              break;

            case 'start':
              if (data.start) {
                twilioService.initializeStreamState(data);
              }
              break;

            //Your application also receives an incoming mark event message if the buffer was cleared using the clear event message.
            case 'mark':
              twilioService.handleMarkEvent();
              break;

            default:
              console.log('Received non-media event:', data.event);
              break;
          }
        } catch (error) {
          console.error(
            'Error parsing message:',
            error,
            'Message:',
            event.data
          );
        }
      },
      onClose: () => {
        console.log('Client disconnected.');
      },
      onError: (event: Event) => {
        console.error('WebSocket error:', event);
      },
    };
  }
);
