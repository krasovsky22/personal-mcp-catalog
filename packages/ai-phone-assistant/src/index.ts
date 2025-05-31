import { Hono } from 'hono';
import type { Env } from './types';
import { homeHandler, incomingCallsHandler } from './handlers/routes';
import { createMediaStreamHandler } from './handlers/websocket';

const app = new Hono<{ Bindings: Env }>();

// Route handlers
app.get('/', homeHandler);
app.all('/incoming-calls', incomingCallsHandler);
app.get('/media-stream', createMediaStreamHandler);

export default app;
