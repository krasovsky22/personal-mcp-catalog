import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fetchBiography, Env } from './fetchBiography';

type State = { biography: string };

export class MyMCP extends McpAgent<Env, State, {}> {
  initialState: State = {
    biography: '',
  };

  server = new McpServer({
    name: 'Biography provider',
    version: '1.0.0',
  });

  async init(): Promise<void> {
    this.server.resource(`biography`, `mcp://resource/biography`, (uri) => {
      return {
        contents: [{ uri: uri.href, text: String(this.state.biography) }],
      };
    });

    this.server.tool(
      'biography_provider',
      'Provides a biography of a Vlad Krasovski',
      async () => {
        const biography = await fetchBiography(this.env);
        console.log(biography);

        this.setState({ ...this.state, biography });

        return {
          content: [
            {
              type: 'text',
              text: biography,
            },
          ],
        };
      }
    );
  }

  onStateUpdate(state: State) {
    console.log({ stateUpdate: state });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === '/sse' || url.pathname === '/sse/message') {
      // @ts-ignore
      return MyMCP.serveSSE('/sse').fetch(request, env, ctx);
    }

    if (url.pathname === '/mcp') {
      // @ts-ignore
      return MyMCP.serve('/mcp').fetch(request, env, ctx);
    }

    if (url.pathname === '/raw-data') {
      const biography = await fetchBiography(env);
      return Response.json(JSON.parse(biography), { status: 200 });
    }

    return new Response('Not found', { status: 404 });
  },
};
