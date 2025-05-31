export interface Env {
  OPENAI_API_SECRET: string;
  BIOGRAPHY_MCP_SERVER: string;
}

export interface WebSocketState {
  callSid: string | null;
  streamSid: string | null;
  accountSid: string | null;
  markQueue: string[];
  pendingAudioDelta?: string;
  speechStarted?: boolean;
}

export interface TwilioMediaEvent {
  event: string;
  streamSid: string;
  media?: {
    timestamp: number;
    payload: string;
  };
  start?: {
    callSid: string;
    streamSid: string;
    accountSid: string;
  };
  mark?: {
    name: string;
  };
}

export interface OpenAIResponse {
  type: string;
  response?: {
    status?: string;
    output?: Array<{
      type: string;
      name: string;
      call_id: string;
    }>;
  };
  delta?: string;
  item_id?: string;
}

export interface BiographyFunctionCall {
  type: 'function_call';
  name: 'load_biography';
  call_id: string;
}

export interface TwilioMarkEventType {
  event: 'mark';
  streamSid: string;
  mark: { name: string };
}
