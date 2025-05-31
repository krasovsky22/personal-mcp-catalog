import { BiographyTool } from '../tools/biography';
import { EnvironmentStore } from '../stores/environment';

import { OpenAIResponse, TwilioMediaEvent } from '../types';
import {
  LOG_EVENT_TYPES,
  OPEN_AI_EVENT,
  OPEN_AI_EVENT_CONVERSATION_ITEM_CREATE,
  OPEN_AI_EVENT_CONVERSATION_ITEM_TRUNCATE,
  OPEN_AI_EVENT_FUNCTION_CALL_OUTPUT,
  OPEN_AI_EVENT_RESPONSE_AUDIO_DELTA,
  OPEN_AI_EVENT_RESPONSE_CREATE,
  OPEN_AI_EVENT_RESPONSE_DONE,
  OPEN_AI_EVENT_SPEECH_STARTED,
  OPEN_AI_OUTPUT_TYPE_FUNCTION_CALL,
} from '../constants/openai-events';

export const VOICE = 'verse'; // OpenAI voice option

export const SYSTEM_MESSAGE = `You are a helpful assistant for Vladislav Krasovski. He also known as Vlad or Vladislav.
You will be advocating on behalf of Vlad Krasovski.
You can only answer questions related to Vlad Krasovski and his biography and work experience.
When any question is asked, it always about Vlad Krasovski.
You should always show Vlad Krasovski from positive side to help him get hired.
You are not allowed to answer any other questions not related to Vladislav Krasovski.
You are not allowed to provide any information about yourself.
You are not allowed to provide any information about the AI model you are using`;

export class OpenAISession {
  private MODEL = 'gpt-4o-mini-realtime-preview';
  private VOICE = 'verse';

  private twilioService = null;
  private openAiWs: WebSocket;

  private state = {
    lastAssistantItem: null,
    latestMediaTimestamp: 0,
    responseStartTimestampTwilio: 0,
  };

  constructor(twilioService) {
    this.twilioService = twilioService;

    this.openAiWs = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${this.MODEL}`,
      [
        'realtime',
        `openai-insecure-api-key.${EnvironmentStore.OPENAI_API_SECRET}`,
        'openai-beta.realtime-v1',
      ]
    );

    // define listeners for the OpenAI WebSocket
    this.openAiWs.addEventListener('open', () => {
      console.log('Connected to realtime API');
      setTimeout(() => this.sendSessionUpdate(), 1000);
    });

    this.openAiWs.addEventListener('message', async (event) => {
      try {
        const response: OpenAIResponse = JSON.parse(event.data.toString());

        if (LOG_EVENT_TYPES.includes(response.type)) {
          console.log(
            `Received event: ${response.type}`,
            JSON.stringify(response, null, 2)
          );
        }

        /** Returned when a Response is done streaming */
        if (response.type === OPEN_AI_EVENT_RESPONSE_DONE) {
          const responseStatus = response.response?.status;

          if (responseStatus === 'failed') {
            console.error('OpenAI response failed:', response.response);
            this.twilioService.hangupCall();
          }

          const output = response.response?.output?.[0];
          if (
            output?.type === OPEN_AI_OUTPUT_TYPE_FUNCTION_CALL &&
            output?.name === BiographyTool.name
          ) {
            const biographyResponse = await BiographyTool.method();
            if (biographyResponse) {
              this.sendEvent({
                type: OPEN_AI_EVENT_CONVERSATION_ITEM_CREATE,
                item: {
                  call_id: output.call_id,
                  type: OPEN_AI_EVENT_FUNCTION_CALL_OUTPUT,
                  output: biographyResponse,
                },
              });
            }
          }
        }

        /** Returned when the model-generated audio is updated. */
        if (
          response.type === OPEN_AI_EVENT_RESPONSE_AUDIO_DELTA &&
          response.delta
        ) {
          this.twilioService.sendAudioDelta(response.delta);

          // First delta from a new response starts the elapsed time counter
          if (!this.state.responseStartTimestampTwilio) {
            this.state.responseStartTimestampTwilio =
              this.state.latestMediaTimestamp;
          }

          if (response.item_id) {
            this.state.lastAssistantItem = response.item_id;
          }
        }

        if (response.type === OPEN_AI_EVENT_SPEECH_STARTED) {
          this.handleSpeechStartedEvent();
        }
      } catch (error) {
        console.error(
          'Error processing OpenAI message:',
          error,
          'Raw message:',
          typeof event.data === 'string' ? event.data : 'Binary data'
        );

        this.twilioService.hangupCall();
      }
    });

    this.openAiWs.addEventListener('close', () => {
      console.log('Disconnected from the OpenAI Realtime API');
    });

    this.openAiWs.addEventListener('error', (event) => {
      console.error('Error in the OpenAI WebSocket:', event);
    });
  }

  sendSessionUpdate() {
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad' },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: this.VOICE,
        instructions: SYSTEM_MESSAGE,
        modalities: ['text', 'audio'],
        temperature: 0.8,
        tool_choice: 'auto',
        tools: [BiographyTool],
      },
    };

    console.log('Sending session update:', JSON.stringify(sessionUpdate));
    this.sendEvent(sessionUpdate);

    // Send initial conversation item to have AI speak first
    this.sendInitialConversationItem();
  }

  sendInitialConversationItem() {
    const initialConversationItem = {
      type: OPEN_AI_EVENT_CONVERSATION_ITEM_CREATE,
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Greet the user with "Hello there! I am an AI voice assistant developed by Vlad. What do you want to know?"',
          },
        ],
      },
    };

    this.sendEvent(initialConversationItem);
    this.sendEvent({ type: OPEN_AI_EVENT_RESPONSE_CREATE });
  }

  // when person started talking
  handleSpeechStartedEvent() {
    if (this.state.responseStartTimestampTwilio) {
      const elapsedTime =
        this.state.latestMediaTimestamp -
        this.state.responseStartTimestampTwilio;

      // Only truncate if we have a positive elapsed time and an assistant item
      if (this.state.lastAssistantItem && elapsedTime > 0) {
        this.sendTruncateEvent(this.state.lastAssistantItem, elapsedTime);
      }

      this.twilioService.clearMedia();
      this.resetState();
    }
  }

  /**
   * Send this event to truncate a previous assistant message’s audio.
   * The server will produce audio faster than realtime, so this event is useful when the user interrupts to truncate audio that has already been sent to the client but not yet played.
   * This will synchronize the server's understanding of the audio with the client's playback.
   * Truncating audio will delete the server-side text transcript to ensure there is not text in the context that hasn't been heard by the user.
   */
  sendTruncateEvent(lastAssistantItem: string, elapsedTime: number) {
    const truncateEvent = {
      type: OPEN_AI_EVENT_CONVERSATION_ITEM_TRUNCATE,
      item_id: lastAssistantItem,
      content_index: 0,
      audio_end_ms: elapsedTime,
    };

    this.sendEvent(truncateEvent);
  }

  resetState() {
    this.state = {
      lastAssistantItem: null,
      latestMediaTimestamp: 0,
      responseStartTimestampTwilio: 0,
    };
  }

  // send audio data to OpenAI
  sendAudioData(media: TwilioMediaEvent['media']) {
    const audioAppend = {
      type: OPEN_AI_EVENT,
      audio: media.payload,
    };
    this.sendEvent(audioAppend);

    this.state.latestMediaTimestamp = media.timestamp;
  }

  sendEvent(data: any) {
    if (this.openAiWs.readyState !== WebSocket.OPEN) {
      return;
    }
    this.openAiWs.send(JSON.stringify(data));
  }
}
