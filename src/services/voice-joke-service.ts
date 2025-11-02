import twilio from 'twilio';
import { config } from '../config.js';
import type { JokeRepository } from '../db/database.js';
import { compareNewJokeAgainstMultiple } from './comparison-service.js';
import { updateEloRatings } from './elo-service.js';

export function extractKnockKnockJoke(transcript: string): string | null {
  const normalized = transcript.toLowerCase().trim();
  
  if (!normalized.includes('knock knock')) {
    return null;
  }

  const knockKnockMatch = normalized.match(/knock\s+knock[\s\S]*/i);
  if (!knockKnockMatch) {
    return null;
  }

  const fullJoke = knockKnockMatch[0].trim();
  
  if (fullJoke.length < 20) {
    return null;
  }

  return fullJoke;
}

export async function transcribeAudio(audioUrl: string): Promise<string> {
  try {
    let file: File;
    
    if (audioUrl.startsWith('file://')) {
      const filePath = audioUrl.replace('file://', '');
      const fileData = await Bun.file(filePath).arrayBuffer();
      file = new File([new Uint8Array(fileData)], 'audio.wav', { type: 'audio/wav' });
    } else {
      const response = await fetch(audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      file = new File([new Uint8Array(arrayBuffer)], 'audio.wav', { type: 'audio/wav' });
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    const transcriptionResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
      },
      body: formData,
    });

    if (!transcriptionResponse.ok) {
      throw new Error(`Transcription failed: ${transcriptionResponse.statusText}`);
    }

    const result = await transcriptionResponse.json();
    return result.text;
  } catch (error) {
    console.error('Transcription error:', error);
    throw new Error('Failed to transcribe audio');
  }
}

export async function processJokeFromRecording(
  recordingUrl: string,
  jokeRepository: JokeRepository
): Promise<{ joke: string; rating: number }> {
  const transcript = await transcribeAudio(recordingUrl);
  const jokeText = extractKnockKnockJoke(transcript);

  if (!jokeText) {
    throw new Error('Could not extract a valid knockknock joke from the recording');
  }

  const existingJokes = jokeRepository.getSampleForComparison(config.elo.comparisonSampleSize);
  
  if (existingJokes.length === 0) {
    const newJoke = jokeRepository.create(jokeText);
    return { joke: jokeText, rating: newJoke.elo_rating };
  }

  const newJoke = jokeRepository.create(jokeText);
  const comparisons = await compareNewJokeAgainstMultiple(jokeText, existingJokes);

  for (const { joke: existingJoke, result } of comparisons) {
    const winner = result.winner === 'joke1' ? 'jokeA' : result.winner === 'joke2' ? 'jokeB' : 'tie';
    const { newRatingA, newRatingB } = updateEloRatings(newJoke, existingJoke, winner);
    
    jokeRepository.updateEloRating(newJoke.id, newRatingA);
    jokeRepository.updateEloRating(existingJoke.id, newRatingB);
  }

  const updatedJoke = jokeRepository.findById(newJoke.id)!;
  return { joke: jokeText, rating: updatedJoke.elo_rating };
}

export function generateTwiMLResponse(message: string): string {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'alice' }, message);
  return twiml.toString();
}

