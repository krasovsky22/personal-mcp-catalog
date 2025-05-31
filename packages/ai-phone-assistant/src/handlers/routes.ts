import type { Context } from 'hono';
import type { Env } from '../types';

export const homeHandler = (c: Context) => {
  return c.text('Welcome to the AI Phone Assistant!');
};

export const incomingCallsHandler = async (c: Context) => {
  // Generate TwiML response for incoming calls
  const twilioResponse = `<?xml version="1.0" encoding="UTF-8"?>
                        <Response>
                            <Say>Connecting to A.I. assistant.</Say>
                            <Connect>
                                <Stream url="wss://${c.req.header(
                                  'Host'
                                )}/media-stream" />
                            </Connect>
                        </Response>`;

  return c.text(twilioResponse, 200, {
    'Content-Type': 'text/xml',
  });
};
