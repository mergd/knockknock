import express from 'express';
import twilio from 'twilio';
import { config } from '../config.js';
import { JokeRepository } from '../db/database.js';
import { processJokeFromRecording } from '../services/voice-joke-service.js';

const router = express.Router();
const VoiceResponse = twilio.twiml.VoiceResponse;

export function createRoutes(jokeRepository: JokeRepository) {
  router.post('/webhook/twilio', (req, res) => {
    console.log('[TWILIO WEBHOOK] Received webhook request');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    const twiml = new VoiceResponse();
    
    const recordingUrl = req.body.RecordingUrl;

    if (recordingUrl) {
      twiml.say({ voice: 'alice' }, 'Thank you for your joke. We are processing it now.');
      twiml.redirect(`/webhook/twilio/process?RecordingUrl=${encodeURIComponent(recordingUrl)}`);
    } else {
      twiml.say({ voice: 'alice' }, 'Hi! Tell me a knockknock joke when you are ready.');
      twiml.record({
        maxLength: 30,
        transcribe: true,
        transcribeCallback: '/webhook/twilio/transcribe',
        recordingStatusCallback: '/webhook/twilio/recording',
      });
      twiml.say({ voice: 'alice' }, 'I did not receive a recording. Goodbye.');
    }

    res.type('text/xml');
    res.send(twiml.toString());
  });

  router.post('/webhook/twilio/process', async (req, res) => {
    console.log('[TWILIO PROCESS] Processing recording');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Request query:', JSON.stringify(req.query, null, 2));
    
    const recordingUrl = req.body.RecordingUrl || req.query.RecordingUrl;
    
    if (!recordingUrl) {
      console.error('[TWILIO PROCESS] No recording URL provided');
      res.status(400).send('No recording URL provided');
      return;
    }

    try {
      const { joke, rating } = await processJokeFromRecording(
        recordingUrl as string,
        jokeRepository
      );

      const twiml = new VoiceResponse();
      twiml.say(
        { voice: 'alice' },
        `Thank you! Your joke has been rated ${rating.toFixed(1)}. `
      );

      const bestJoke = jokeRepository.getBestJoke();
      if (bestJoke) {
        twiml.say(
          { voice: 'alice' },
          `The current best joke is: ${bestJoke.content}. It has a rating of ${bestJoke.elo_rating.toFixed(1)}.`
        );
      }

      twiml.say({ voice: 'alice' }, 'Goodbye!');
      
      res.type('text/xml');
      res.send(twiml.toString());
    } catch (error) {
      console.error('[TWILIO PROCESS] Error processing joke:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      const twiml = new VoiceResponse();
      twiml.say({ voice: 'alice' }, "Sorry, I couldn't process your joke. Please try again.");
      res.type('text/xml');
      res.send(twiml.toString());
    }
  });

  router.post('/webhook/twilio/transcribe', async (req, res) => {
    const transcript = req.body.TranscriptionText;
    const recordingUrl = req.body.RecordingUrl;

    console.log('Transcription received:', transcript);
    console.log('Recording URL:', recordingUrl);

    res.status(200).send('OK');
  });

  router.post('/webhook/twilio/recording', async (req, res) => {
    const recordingUrl = req.body.RecordingUrl;
    const callSid = req.body.CallSid;

    console.log('Recording completed:', recordingUrl);
    console.log('Call SID:', callSid);

    res.status(200).send('OK');
  });

  router.get('/best-joke', (req, res) => {
    const bestJoke = jokeRepository.getBestJoke();
    
    if (!bestJoke) {
      res.json({ error: 'No jokes found' });
      return;
    }

    res.json({
      joke: bestJoke.content,
      rating: bestJoke.elo_rating,
      id: bestJoke.id,
    });
  });

  router.get('/jokes', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 10;
    const jokes = jokeRepository.getTopJokes(limit);
    res.json(jokes);
  });

  return router;
}

