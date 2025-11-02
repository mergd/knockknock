import { config } from '../config.js';
import type { Joke } from '../db/database.js';

export function calculateElo(ratingA: number, ratingB: number, scoreA: number): {
  newRatingA: number;
  newRatingB: number;
} {
  const expectedA = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;

  const newRatingA = ratingA + config.elo.kFactor * (scoreA - expectedA);
  const newRatingB = ratingB + config.elo.kFactor * ((1 - scoreA) - expectedB);

  return {
    newRatingA: Math.round(newRatingA * 100) / 100,
    newRatingB: Math.round(newRatingB * 100) / 100,
  };
}

export function updateEloRatings(
  jokeA: Joke,
  jokeB: Joke,
  winner: 'jokeA' | 'jokeB' | 'tie'
): {
  newRatingA: number;
  newRatingB: number;
} {
  const scoreA = winner === 'jokeA' ? 1 : winner === 'jokeB' ? 0 : 0.5;
  return calculateElo(jokeA.elo_rating, jokeB.elo_rating, scoreA);
}

