import { EnvironmentStore } from '../stores/environment';

const BIOGRAPHY_FUNCTION_NAME = 'load_biography';

const handleLoadBiography = async () => {
  const response = await fetch(EnvironmentStore.BIOGRAPHY_MCP_SERVER);
  const biography = await response.text();

  return biography;
};

export const BiographyTool = {
  type: 'function',
  name: BIOGRAPHY_FUNCTION_NAME,
  description:
    'Vlad Krasovsky initial biography and summary if his personal and professions background',
  parameters: {
    type: 'object',
    properties: {},
  },
  method: handleLoadBiography,
};
