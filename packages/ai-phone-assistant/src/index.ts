import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/cloudflare-workers';

const MODEL = 'gpt-4o-realtime-preview';
const VOICE = 'alloy'; // OpenAI voice option
const SYSTEM_MESSAGE = `You are a helpful assistant. You will be advocating on behalf of Vlad Krasovski.
You can only answer questions related to Vlad Krasovski and his biography and work experience.
You can only answer question based on technical biography..
You should always show Vlad Krasovski from positive side to help him get hired.
You are not allowed to answer any other questions.
You are not allowed to provide any information about yourself.
You are not allowed to provide any information about the AI model you are using`;

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();
const LOG_EVENT_TYPES = [
  'error',
  'response.content.done',
  'rate_limits.updated',
  'response.done',
  'input_audio_buffer.committed',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.speech_started',
  'session.created',
];

// Show AI response elapsed timing calculations
const SHOW_TIMING_MATH = false;

app.get('/', (c) => {
  return c.text('Welcome to the AI Phone Assistant!');
});

app.get('/data', async (c) => {
  const response = await fetch(c.env.BIOGRAPHY_MCP_SERVER);
  const biography = await response.json();
  console.log(biography);
  return c.json(biography);
});

app.all('/incoming-calls', async (c) => {
  console.log('Incoming call received:', c);
  // Generate TwiML response for incoming calls
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                        <Response>
                            <Say>Connecting to A.I. assistant.</Say>
                            <Connect>
                                <Stream url="wss://${c.req.header(
                                  'Host'
                                )}/media-stream" />
                            </Connect>    
                        </Response>`;

  return c.text(twimlResponse, 200, {
    'Content-Type': 'text/xml',
  });
});

app.get(
  '/media-stream',
  upgradeWebSocket((c) => {
    console.log('WebSocket connection established with statusCode');

    let streamSid = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem = null;
    let markQueue = [];
    let responseStartTimestampTwilio = null;
    let openAiWs = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${MODEL}`,
      [
        'realtime',
        // Auth
        'openai-insecure-api-key.' + c.env.OPENAI_API_SECRET,
        // Beta protocol, required
        'openai-beta.realtime-v1',
      ]
    );

    let localWs = null;

    openAiWs.addEventListener('open', () => {
      console.log('Connected to realtime API');
      setTimeout(sendSessionUpdate, 1000); // Ensure connectivity stability
    });

    const handleLoadBiography = async (output) => {
      if (
        output?.type === 'function_call' &&
        output?.name === 'load_biography' &&
        output?.call_id
      ) {
        const response = await fetch(c.env.BIOGRAPHY_MCP_SERVER);
        const biography = await response.json();

        console.log(biography);

        return {
          type: 'conversation.item.create',
          item: {
            call_id: output.call_id,
            type: 'function_call_output',
            output: biography,
          },
        };
      }
    };

    // Listen for messages from the OpenAI WebSocket (and send to Twilio if necessary)
    openAiWs.addEventListener('message', async (event) => {
      try {
        const response = JSON.parse(event.data.toString());

        if (LOG_EVENT_TYPES.includes(response.type)) {
          console.log(
            `Received event: ${response.type}`,
            JSON.stringify(response, null, 2)
          );

          if (response.type === 'response.done') {
            const output = response.response?.output?.[0];

            const biographyResponse = await handleLoadBiography(output);
            openAiWs.send(JSON.stringify(biographyResponse));
          }
        }

        if (response.type === 'response.audio.delta' && response.delta) {
          const audioDelta = {
            event: 'media',
            streamSid: streamSid,
            media: { payload: response.delta },
          };
          if (localWs) {
            localWs.send(JSON.stringify(audioDelta));
            sendMark(localWs, streamSid);
          }

          // First delta from a new response starts the elapsed time counter
          if (!responseStartTimestampTwilio) {
            responseStartTimestampTwilio = latestMediaTimestamp;
            if (SHOW_TIMING_MATH)
              console.log(
                `Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`
              );
          }

          if (response.item_id) {
            lastAssistantItem = response.item_id;
          }
        }

        if (response.type === 'input_audio_buffer.speech_started') {
          if (localWs) handleSpeechStartedEvent(localWs);
        }
      } catch (error) {
        console.error(
          'Error processing OpenAI message:',
          error,
          'Raw message:',
          event.data
        );
      }
    });

    openAiWs.addEventListener('close', () => {
      console.log('Disconnected from the OpenAI Realtime API');
    });

    openAiWs.addEventListener('error', (event) => {
      console.error('Error in the OpenAI WebSocket:', event);
    });

    // Control initial session with OpenAI
    const sendSessionUpdate = () => {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          turn_detection: { type: 'server_vad' },
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          voice: VOICE,
          instructions: SYSTEM_MESSAGE,
          modalities: ['text', 'audio'],
          temperature: 0.8,
          tool_choice: 'auto',
          tools: [
            {
              type: 'function',
              name: 'load_biography',
              description: 'Load biography',
              parameters: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Who are you calling about?',
                  },
                },
              },
            },
          ],
        },
      };

      console.log('Sending session update:', JSON.stringify(sessionUpdate));
      openAiWs.send(JSON.stringify(sessionUpdate));

      // Uncomment the following line to have AI speak first:
      sendInitialConversationItem();
    };

    // Send initial conversation item if AI talks first
    const sendInitialConversationItem = () => {
      const initialConversationItem = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Greet the user with "Hello there! I am an AI voice assistant developer by Vlad Krasovsky. I have all details about Vlad\'s professions background. What do you want to know?"',
            },
          ],
        },
      };

      if (SHOW_TIMING_MATH)
        console.log(
          'Sending initial conversation item:',
          JSON.stringify(initialConversationItem)
        );
      openAiWs.send(JSON.stringify(initialConversationItem));
      openAiWs.send(JSON.stringify({ type: 'response.create' }));
    };

    // Handle interruption when the caller's speech starts
    const handleSpeechStartedEvent = (ws) => {
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
        if (SHOW_TIMING_MATH)
          console.log(
            `Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`
          );

        if (lastAssistantItem) {
          const truncateEvent = {
            type: 'conversation.item.truncate',
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime,
          };
          if (SHOW_TIMING_MATH)
            console.log(
              'Sending truncation event:',
              JSON.stringify(truncateEvent)
            );
          openAiWs.send(JSON.stringify(truncateEvent));
        }

        ws.send(
          JSON.stringify({
            event: 'clear',
            streamSid: streamSid,
          })
        );

        // Reset
        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestampTwilio = null;
      }
    };

    // Send mark messages to Media Streams so we know if and when AI response playback is finished
    const sendMark = (ws, streamSid) => {
      if (streamSid) {
        const markEvent = {
          event: 'mark',
          streamSid: streamSid,
          mark: { name: 'responsePart' },
        };

        console.log('sending mark event:', markEvent);
        ws.send(JSON.stringify(markEvent));
        markQueue.push('responsePart');
      }
    };

    return {
      onMessage(event, ws) {
        localWs = ws;
        try {
          const data = JSON.parse(event.data);

          switch (data.event) {
            case 'media':
              latestMediaTimestamp = data.media.timestamp;
              if (SHOW_TIMING_MATH)
                console.log(
                  `Received media message with timestamp: ${latestMediaTimestamp}ms`
                );

              if (openAiWs.readyState === WebSocket.OPEN) {
                const audioAppend = {
                  type: 'input_audio_buffer.append',
                  audio: data.media.payload,
                };
                openAiWs.send(JSON.stringify(audioAppend));
              }
              break;

            case 'start':
              streamSid = data.start.streamSid;
              console.log('Incoming stream has started', streamSid);

              // Reset start and media timestamp on a new stream
              responseStartTimestampTwilio = null;
              latestMediaTimestamp = 0;
              break;

            case 'mark':
              if (markQueue.length > 0) {
                markQueue.shift();
              }
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
      onClose: (event) => {
        if (openAiWs?.readyState === WebSocket.OPEN) openAiWs.close();
        console.log('Client disconnected.');
      },
      onError: (event) => {
        console.error('WebSocket error:', event);
      },
    };
  })
);

// Export the Hono app
export default app;
