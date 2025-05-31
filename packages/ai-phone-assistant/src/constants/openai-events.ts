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
 * Returned when a Response is done streaming.
 * Always emitted, no matter the final state.
 * The Response object included in the response.done event will include all output Items in the Response but will omit the raw audio data.
 * */
export const OPEN_AI_EVENT_RESPONSE_DONE = 'response.done';

/**
 * Add a new Item to the Conversation's context, including messages, function calls, and function call responses.
 * This event can be used both to populate a "history" of the conversation and to add new items mid-stream, but has the current limitation that it cannot populate assistant audio messages.
 * If successful, the server will respond with a conversation.item.created event, otherwise an error event will be sent.
 */
export const OPEN_AI_EVENT_CONVERSATION_ITEM_CREATE =
  'conversation.item.create';

/**
 * This event instructs the server to create a Response, which means triggering model inference. When in Server VAD mode, the server will create Responses automatically.
 * A Response will include at least one Item, and may have two, in which case the second will be a function call. These Items will be appended to the conversation history.
 * The server will respond with a response.created event, events for Items and content created, and finally a response.done event to indicate the Response is complete.
 * The response.create event includes inference configuration like instructions, and temperature. These fields will override the Session's configuration for this Response
 */
export const OPEN_AI_EVENT_RESPONSE_CREATE = 'response.create';

/**
 * Provide the results of a function call to the model
 * Upon receiving a response from the model with arguments to a function call, your application can execute code that satisfies the function call.
 * This could be anything you want, like talking to external APIs or accessing databases.
 * Once you are ready to give the model the results of your custom code, you can create a new conversation item containing the result via the conversation.item.create client event.
 */
export const OPEN_AI_EVENT_FUNCTION_CALL_OUTPUT = 'function_call_output';

/** Returned when the model-generated audio is updated. */
export const OPEN_AI_EVENT_RESPONSE_AUDIO_DELTA = 'response.audio.delta';

/**
 * Sent by the server when in server_vad mode to indicate that speech has been detected in the audio buffer.
 * This can happen any time audio is added to the buffer (unless speech is already detected).
 * The client may want to use this event to interrupt audio playback or provide visual feedback to the user.
 * The client should expect to receive a input_audio_buffer.speech_stopped event when speech stops.
 *  The item_id property is the ID of the user message item that will be created when speech stops and will also be included in the input_audio_buffer.speech_stopped event
 * (unless the client manually commits the audio buffer during VAD activation).
 */
export const OPEN_AI_EVENT_SPEECH_STARTED = 'input_audio_buffer.speech_started';

/**
 * Send this event to truncate a previous assistant message’s audio.
 * The server will produce audio faster than realtime, so this event is useful when the user interrupts to truncate audio that has already been sent to the client but not yet played.
 * This will synchronize the server's understanding of the audio with the client's playback.
 * Truncating audio will delete the server-side text transcript to ensure there is not text in the context that hasn't been heard by the user.
 * If successful, the server will respond with a conversation.item.truncated event.
 */
export const OPEN_AI_EVENT_CONVERSATION_ITEM_TRUNCATE =
  'conversation.item.truncate';

/**
 * https://platform.openai.com/docs/api-reference/chat/create#chat-create-function_call
 * Optional Deprecated in favor of tool_choice.
 * Controls which (if any) function is called by the model.
 * none means the model will not call a function and instead generates a message.
 * auto means the model can pick between generating a message or calling a function.
 * Specifying a particular function via {"name": "my_function"} forces the model to call that function.
 * none is the default when no functions are present. auto is the default if functions are present.
 */
export const OPEN_AI_OUTPUT_TYPE_FUNCTION_CALL = 'function_call';

/**
 * Send this event to append audio bytes to the input audio buffer.
 * The audio buffer is temporary storage you can write to and later commit.
 * In Server VAD mode, the audio buffer is used to detect speech and the server will decide when to commit.
 * When Server VAD is disabled, you must commit the audio buffer manually.
 * The client may choose how much audio to place in each event up to a maximum of 15 MiB, for example streaming smaller chunks from the client may allow the VAD to be more responsive.
 * Unlike made other client events, the server will not send a confirmation response to this event.
 */
export const OPEN_AI_EVENT = 'input_audio_buffer.append';
