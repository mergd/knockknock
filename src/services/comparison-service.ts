import OpenAI from 'openai';
import { config } from '../config.js';
import type { Joke } from '../db/database.js';

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

export type ComparisonResult = {
  winner: 'joke1' | 'joke2' | 'tie';
  reasoning?: string;
};

export async function compareJokes(joke1: string, joke2: string): Promise<ComparisonResult> {
  const prompt = `You are judging two knockknock jokes. Determine which one is funnier.

Joke 1: "${joke1}"

Joke 2: "${joke2}"

Respond with ONLY a JSON object in this exact format:
{
  "winner": "joke1" | "joke2" | "tie",
  "reasoning": "brief explanation"
}`;

  const response = await openai.chat.completions.create({
    model: config.openai.model,
    messages: [
      {
        role: 'system',
        content: 'You are a judge of knockknock jokes. Respond only with valid JSON.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI');
  }

  try {
    const result = JSON.parse(content) as ComparisonResult;
    if (!['joke1', 'joke2', 'tie'].includes(result.winner)) {
      return { winner: 'tie' };
    }
    return result;
  } catch (error) {
    console.error('Failed to parse comparison result:', error);
    return { winner: 'tie' };
  }
}

export async function compareNewJokeAgainstMultiple(
  newJoke: string,
  existingJokes: Joke[]
): Promise<Array<{ joke: Joke; result: ComparisonResult }>> {
  const comparisons = existingJokes.map(async (joke) => {
    const result = await compareJokes(newJoke, joke.content);
    return { joke, result };
  });

  return Promise.all(comparisons);
}

