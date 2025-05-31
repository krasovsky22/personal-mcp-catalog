import type {
  TwilioMarkEventType,
  TwilioMediaEvent,
  WebSocketState,
} from '../types';
import { OpenAISession } from './openai';

export class TwilioService {
  private ws: WebSocket;

  state: WebSocketState = {
    callSid: null,
    streamSid: null,
    accountSid: null,
    markQueue: [],
  };

  openAiSession: OpenAISession = null;

  constructor(ws: WebSocket) {
    this.ws = ws;

    this.openAiSession = new OpenAISession(this);
  }

  public initializeStreamState(data: TwilioMediaEvent) {
    this.state.callSid = data.start.callSid;
    this.state.streamSid = data.start.streamSid;
    this.state.accountSid = data.start.accountSid;

    console.log('Incoming stream has started', this.state.streamSid);
  }

  // send media to OpenAI
  public sendAudioToOpenAI(media: TwilioMediaEvent['media']) {
    this.openAiSession.sendAudioData(media);
  }

  // send audio back to twilio
  public sendAudioDelta(delta: string) {
    const audioDeltaEvent = {
      event: 'media',
      streamSid: this.state.streamSid,
      media: { payload: delta },
    };

    this.sendEvent(audioDeltaEvent);

    // Send a mark event message after sending a media event message to be notified when the audio that you have sent has been completed.
    this.sendMarkMessage();
  }

  // Stop any media from twilio
  public clearMedia() {
    const { streamSid } = this.state;
    this.sendEvent({
      event: 'clear',
      streamSid: streamSid,
    });

    this.resetState();
  }

  public hangupCall() {
    const { streamSid, callSid, accountSid } = this.state;

    const hangupEvent = {
      event: 'stop',
      streamSid: streamSid,
      stop: {
        accountSid,
        callSid,
      },
    };
    this.sendEvent(hangupEvent);
  }

  public resetState() {
    this.state.markQueue = [];
  }

  /**
   * Send a mark event message after sending a media event message to be notified when the audio that you have sent has been completed.
   * Twilio sends back a mark event with a matching name when the audio ends (or if there is no audio buffered).
   * Your application also receives an incoming mark event message if the buffer was cleared using the clear event message.
   */
  public sendMarkMessage() {
    const markEvent: TwilioMarkEventType = {
      event: 'mark',
      streamSid: this.state.streamSid!,
      mark: { name: 'responsePart' },
    };

    this.sendEvent(markEvent);
    this.state.markQueue.push('responsePart');
  }

  /** Your application also receives an incoming mark event message if the buffer was cleared using the clear event message. */
  public handleMarkEvent() {
    if (this.state.markQueue.length > 0) {
      this.state.markQueue.shift();
    }
  }

  public sendEvent(event: any) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    } else {
      console.error('WebSocket is not open. Cannot send event:', event);
    }
  }
}
