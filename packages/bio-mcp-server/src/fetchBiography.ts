export interface Env {
  biography: KVNamespace;
}

const STORY_KEY = 'story';

export async function fetchBiography(env: Env): Promise<string> {
  try {
    const story = await env.biography.get(STORY_KEY);
    if (!story) {
      return 'Biography not found in KV storage.';
    }
    return story;
  } catch (error) {
    console.error('Error fetching biography:', error);
    return 'Error retrieving biography data.';
  }
}
