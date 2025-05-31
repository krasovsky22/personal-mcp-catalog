import type { Env } from '../types';

export class EnvironmentStore {
  public static OPENAI_API_SECRET: string = '';
  public static BIOGRAPHY_MCP_SERVER: string = '';

  static initialize(env: Env) {
    EnvironmentStore.OPENAI_API_SECRET = env.OPENAI_API_SECRET;
    EnvironmentStore.BIOGRAPHY_MCP_SERVER = env.BIOGRAPHY_MCP_SERVER;
  }
}
