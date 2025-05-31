import { BiographyTool } from '../tools/biography';
import { EnvironmentStore } from '../stores/environment';

import { OpenAIResponse, TwilioMediaEvent } from '../types';

export const VOICE = 'verse'; // OpenAI voice option

export const SYSTEM_MESSAGE = `You are a helpful assistant for Vladislav Krasovski. He also known as Vlad or Vladislav.
You will be advocating on behalf of Vlad Krasovski.
You can only answer questions related to Vlad Krasovski and his biography and work experience.
When any question is asked, it always about Vlad Krasovski.
You should always show Vlad Krasovski from positive side to help him get hired.
You are not allowed to answer any other questions not related to Vladislav Krasovski.
You are not allowed to provide any information about yourself.
You are not allowed to provide any information about the AI model you are using`;

/**
 * Returned when a Response is done streaming.
 * Always emitted, no matter the final state.
 * The Response object included in the response.done event will include all output Items in the Response but will omit the raw audio data.
 * */
export const OPEN_AI_EVENT_RESPONSE_DONE = 'response.done';
export const LOG_EVENT_TYPES = [
  'error',
  'response.content.done',
  'rate_limits.updated',
  'input_audio_buffer.committed',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.speech_started',
  'session.created',
];

/**
 * Add a new Item to the Conversation's context, including messages, function calls, and function call responses.
 * This event can be used both to populate a "history" of the conversation and to add new items mid-stream, but has the current limitation that it cannot populate assistant audio messages.
 * If successful, the server will respond with a conversation.item.created event, otherwise an error event will be sent.
 */
const OPEN_AI_EVENT_CONVERSATION_ITEM_CREATE = 'conversation.item.create';

/**
 * This event instructs the server to create a Response, which means triggering model inference. When in Server VAD mode, the server will create Responses automatically.
 * A Response will include at least one Item, and may have two, in which case the second will be a function call. These Items will be appended to the conversation history.
 * The server will respond with a response.created event, events for Items and content created, and finally a response.done event to indicate the Response is complete.
 * The response.create event includes inference configuration like instructions, and temperature. These fields will override the Session's configuration for this Response
 */
const OPEN_AI_EVENT_RESPONSE_CREATE = 'response.create';

/**
 * Provide the results of a function call to the model
 * Upon receiving a response from the model with arguments to a function call, your application can execute code that satisfies the function call.
 * This could be anything you want, like talking to external APIs or accessing databases.
 * Once you are ready to give the model the results of your custom code, you can create a new conversation item containing the result via the conversation.item.create client event.
 */
const OPEN_AI_EVENT_FUNCTION_CALL_OUTPUT = 'function_call_output';

/** Returned when the model-generated audio is updated. */
const OPEN_AI_EVENT_RESPONSE_AUDIO_DELTA = 'response.audio.delta';

/**
 * Sent by the server when in server_vad mode to indicate that speech has been detected in the audio buffer.
 * This can happen any time audio is added to the buffer (unless speech is already detected).
 * The client may want to use this event to interrupt audio playback or provide visual feedback to the user.
 * The client should expect to receive a input_audio_buffer.speech_stopped event when speech stops.
 *  The item_id property is the ID of the user message item that will be created when speech stops and will also be included in the input_audio_buffer.speech_stopped event
 * (unless the client manually commits the audio buffer during VAD activation).
 */
const OPEN_AI_EVENT_SPEECH_STARTED = 'input_audio_buffer.speech_started';

/**
 * Send this event to truncate a previous assistant message’s audio.
 * The server will produce audio faster than realtime, so this event is useful when the user interrupts to truncate audio that has already been sent to the client but not yet played.
 * This will synchronize the server's understanding of the audio with the client's playback.
 * Truncating audio will delete the server-side text transcript to ensure there is not text in the context that hasn't been heard by the user.
 * If successful, the server will respond with a conversation.item.truncated event.
 */
const OPEN_AI_EVENT_CONVERSATION_ITEM_TRUNCATE = 'conversation.item.truncate';

/**
 * https://platform.openai.com/docs/api-reference/chat/create#chat-create-function_call
 * Optional Deprecated in favor of tool_choice.
 * Controls which (if any) function is called by the model.
 * none means the model will not call a function and instead generates a message.
 * auto means the model can pick between generating a message or calling a function.
 * Specifying a particular function via {"name": "my_function"} forces the model to call that function.
 * none is the default when no functions are present. auto is the default if functions are present.
 */
const OPEN_AI_OUTPUT_TYPE_FUNCTION_CALL = 'function_call';

/**
 * Send this event to append audio bytes to the input audio buffer.
 * The audio buffer is temporary storage you can write to and later commit.
 * In Server VAD mode, the audio buffer is used to detect speech and the server will decide when to commit.
 * When Server VAD is disabled, you must commit the audio buffer manually.
 * The client may choose how much audio to place in each event up to a maximum of 15 MiB, for example streaming smaller chunks from the client may allow the VAD to be more responsive.
 * Unlike made other client events, the server will not send a confirmation response to this event.
 */
const OPEN_AI_EVENT = 'input_audio_buffer.append';

export class OpenAISession {
  private MODEL = 'gpt-4o-mini-realtime-preview';
  private VOICE = 'verse';

  private twilioService = null;
  private openAiWs: WebSocket;

  private state = {
    lastAssistantItem: null,
    //     callSid: null,
    //     streamSid: null,
    //     accountSid: null,
    latestMediaTimestamp: 0,
    //     lastAssistantItem: null,
    //     markQueue: [],
    responseStartTimestampTwilio: null,
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
    if (this.state.responseStartTimestampTwilio != null) {
      const elapsedTime =
        this.state.latestMediaTimestamp -
        this.state.responseStartTimestampTwilio;

      if (this.state.lastAssistantItem) {
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
      responseStartTimestampTwilio: null,
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
