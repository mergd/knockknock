import WebSocket from 'ws';
import http from 'http';
import { Express } from 'express';
import { config } from '../config.js';
import { CartesiaTTSService } from './cartesia-service.js';
import { JokeRepository } from '../db/database.js';
import { processJokeFromRecording } from './voice-joke-service.js';
import {
  createConversationContext,
  updateConversationState,
  getResponseForState,
  ConversationState,
  type ConversationContext,
} from './conversation-state.js';
import { RealtimeTranscriptionService } from './realtime-transcription.js';

export class TwilioWebSocketService {
  private wss: WebSocket.Server | null = null;
  private server: http.Server | null = null;
  private cartesiaService: CartesiaTTSService;
  private jokeRepository: JokeRepository;

  constructor(cartesiaService: CartesiaTTSService, jokeRepository: JokeRepository) {
    this.cartesiaService = cartesiaService;
    this.jokeRepository = jokeRepository;
  }

  async start(port: number, expressApp?: Express): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = expressApp 
        ? http.createServer(expressApp as any)
        : http.createServer((req, res) => {
            res.writeHead(200);
            res.end('Twilio WebSocket server is running');
          });

      this.wss = new WebSocket.Server({ server: this.server });

      this.wss.on('connection', (twilioWs, request) => {
        console.log(`[WS] Twilio WebSocket connection from ${request.socket.remoteAddress}`);
        console.log(`[WS] Request URL: ${request.url}`);
        console.log(`[WS] Headers:`, JSON.stringify(request.headers, null, 2));
        this.handleTwilioConnection(twilioWs);
      });

      this.wss.on('error', (error) => {
        console.error('[WS] WebSocket server error:', error);
      });

      this.server.listen(port, () => {
        const actualPort = (this.server!.address() as any).port;
        console.log(`Twilio WebSocket server running on port ${actualPort}`);
        resolve(actualPort);
      });

      this.server.on('error', (error) => {
        console.error('HTTP server error:', error);
        reject(error);
      });
    });
  }

  private async handleTwilioConnection(twilioWs: WebSocket) {
    let streamSid: string | null = null;
    const conversationContext = createConversationContext();
    const transcriptionService = new RealtimeTranscriptionService();
    let transcriptionTimer: NodeJS.Timeout | null = null;
    let lastAudioTime = Date.now();
    let isProcessingJoke = false;
    let mediaSequence = 0;

    twilioWs.on('message', async (message: WebSocket.Data) => {
      try {
        const msg = JSON.parse(message.toString());

        if (msg.event === 'start') {
          console.log('[TWILIO] Media stream started');
          console.log('[TWILIO] Stream SID:', msg.start.streamSid);
          console.log('[TWILIO] Start event:', JSON.stringify(msg.start, null, 2));
          streamSid = msg.start.streamSid;
          mediaSequence = 0;
          
          await this.cartesiaService.connect();
          
          const greeting = "<emotion value='friendly'/>Hi! Tell me your best knock knock joke. Go ahead!";
          await this.cartesiaService.streamText(greeting, false);
          const hasGreetingAudio = await this.cartesiaService.waitForAudio(2000);
          if (hasGreetingAudio) {
            const chunkCount = await this.sendAudioToTwilio(twilioWs, streamSid, () => mediaSequence++);
            console.log(`[TWILIO] Sent greeting audio: ${chunkCount} chunks`);
          } else {
            console.warn('[TWILIO] No audio received from Cartesia for greeting');
          }

          transcriptionTimer = setInterval(async () => {
            if (await transcriptionService.shouldTranscribe()) {
              const transcript = await transcriptionService.transcribeBuffer();
              if (transcript.trim().length > 0) {
                console.log(`[TRANSCRIPT] "${transcript}" (State: ${conversationContext.state})`);
                lastAudioTime = Date.now();
                
                  const response = getResponseForState(conversationContext, transcript);
                if (response) {
                  console.log(`[BOT RESPONSE] "${response}"`);
                  await this.cartesiaService.streamText(response, true);
                  const hasAudio = await this.cartesiaService.waitForAudio(2000);
                  if (hasAudio) {
                    const chunkCount = await this.sendAudioToTwilio(twilioWs, streamSid!, () => mediaSequence++);
                    console.log(`[TWILIO] Sent response audio: ${chunkCount} chunks`);
                  } else {
                    console.warn('[TWILIO] No audio received from Cartesia for response');
                  }
                  transcriptionService.reset();
                } else {
                  updateConversationState(conversationContext, transcript);
                  
                  if (conversationContext.state === ConversationState.COMPLETED && !isProcessingJoke) {
                    console.log('[JOKE COMPLETE] Processing...');
                    isProcessingJoke = true;
                    if (transcriptionTimer) {
                      clearInterval(transcriptionTimer);
                      transcriptionTimer = null;
                    }
                    await this.completeJoke(conversationContext, twilioWs, streamSid!);
                    isProcessingJoke = false;
                  }
                }
              }
            }
          }, 500);

        } else if (msg.event === 'media') {
          const payload = msg.media.payload;
          const audioData = Buffer.from(payload, 'base64');
          transcriptionService.addAudioChunk(audioData);
          lastAudioTime = Date.now();

        } else if (msg.event === 'stop') {
          console.log('Twilio media stream stopped');
          if (transcriptionTimer) {
            clearInterval(transcriptionTimer);
            transcriptionTimer = null;
          }
          
          if (!isProcessingJoke) {
            const finalTranscript = await transcriptionService.transcribeBuffer();
            if (finalTranscript.trim().length > 0) {
              updateConversationState(conversationContext, finalTranscript);
              if (conversationContext.state === ConversationState.COMPLETED) {
                isProcessingJoke = true;
                await this.completeJoke(conversationContext, twilioWs, streamSid!);
                isProcessingJoke = false;
              }
            }
          }
          
          setTimeout(() => {
            this.cartesiaService.disconnect();
          }, 2000);
        }
      } catch (error) {
        console.error('Error handling Twilio message:', error);
      }
    });

    twilioWs.on('close', () => {
      console.log('Twilio WebSocket disconnected');
      if (transcriptionTimer) {
        clearInterval(transcriptionTimer);
        transcriptionTimer = null;
      }
      
      const checkAndDisconnect = () => {
        if (!isProcessingJoke) {
          this.cartesiaService.disconnect();
        } else {
          setTimeout(checkAndDisconnect, 1000);
        }
      };
      
      setTimeout(checkAndDisconnect, 2000);
    });

    twilioWs.on('error', (error) => {
      console.error('Twilio WebSocket error:', error);
    });
  }

  private async sendAudioToTwilio(twilioWs: WebSocket, streamSid: string, getSequence?: () => number): Promise<number> {
    const audioChunks = this.cartesiaService.getAudioChunks();
    
    for (const chunk of audioChunks) {
      const payload = chunk.toString('base64');
      const message: any = {
        event: 'media',
        streamSid: streamSid,
        media: {
          payload: payload,
        },
      };
      
      if (getSequence) {
        message.sequenceNumber = getSequence().toString();
      }
      
      twilioWs.send(JSON.stringify(message));
      
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    
    return audioChunks.length;
  }

  private async saveAudioChunks(audioChunks: Buffer[]): Promise<string> {
    const audioBuffer = Buffer.concat(audioChunks);
    const tempFile = `/tmp/recording-${Date.now()}.wav`;
    await Bun.write(tempFile, audioBuffer);
    return `file://${tempFile}`;
  }

  private async completeJoke(
    context: ConversationContext,
    twilioWs: WebSocket,
    streamSid: string
  ) {
    let mediaSequence = 0;
    const getSequence = () => mediaSequence++;
    
    try {
      if (!context.name || !context.punchline) {
        throw new Error('Incomplete joke');
      }

      const jokeText = `Knock knock. Who's there? ${context.name}. ${context.name} who? ${context.punchline}`;
      console.log(`[JOKE COMPLETE] ${jokeText}`);

      try {
        await this.cartesiaService.streamText("<emotion value='excited'/>Ha ha! That's funny!", true);
        const hasLaughAudio = await this.cartesiaService.waitForAudio(2000);
        if (hasLaughAudio) {
          await this.sendAudioToTwilio(twilioWs, streamSid, getSequence);
        }
      } catch (error) {
        console.error('[CARTESIA] Error sending laugh audio:', error);
      }

      try {
        await this.cartesiaService.streamText("Processing your joke...", true);
        const hasProcessingAudio = await this.cartesiaService.waitForAudio(2000);
        if (hasProcessingAudio) {
          await this.sendAudioToTwilio(twilioWs, streamSid, getSequence);
        }
      } catch (error) {
        console.error('[CARTESIA] Error sending processing audio:', error);
      }

      const existingJokes = this.jokeRepository.getSampleForComparison(config.elo.comparisonSampleSize);
      
      if (existingJokes.length === 0) {
        const newJoke = this.jokeRepository.create(jokeText);
        const responseMessage = `<emotion value='friendly'/>Thank you! Your joke has been rated ${newJoke.elo_rating.toFixed(1)}.`;
        try {
          await this.cartesiaService.streamText(responseMessage, true);
          const hasRatingAudio = await this.cartesiaService.waitForAudio(2000);
          if (hasRatingAudio) {
            await this.sendAudioToTwilio(twilioWs, streamSid, getSequence);
          }
        } catch (error) {
          console.error('[CARTESIA] Error sending rating audio:', error);
        }
      } else {
        const { compareNewJokeAgainstMultiple } = await import('./comparison-service.js');
        const { updateEloRatings } = await import('./elo-service.js');
        
        const newJoke = this.jokeRepository.create(jokeText);
        const comparisons = await compareNewJokeAgainstMultiple(jokeText, existingJokes);

        for (const { joke: existingJoke, result } of comparisons) {
          const winner = result.winner === 'joke1' ? 'jokeA' : result.winner === 'joke2' ? 'jokeB' : 'tie';
          const { newRatingA, newRatingB } = updateEloRatings(newJoke, existingJoke, winner);
          
          this.jokeRepository.updateEloRating(newJoke.id, newRatingA);
          this.jokeRepository.updateEloRating(existingJoke.id, newRatingB);
        }

        const updatedJoke = this.jokeRepository.findById(newJoke.id)!;
        const responseMessage = `<emotion value='friendly'/>Thank you! Your joke has been rated ${updatedJoke.elo_rating.toFixed(1)}.`;
        try {
          await this.cartesiaService.streamText(responseMessage, true);
          const hasRatingAudio = await this.cartesiaService.waitForAudio(2000);
          if (hasRatingAudio) {
            await this.sendAudioToTwilio(twilioWs, streamSid, getSequence);
          }
        } catch (error) {
          console.error('[CARTESIA] Error sending rating audio:', error);
        }

        const bestJoke = this.jokeRepository.getBestJoke();
        if (bestJoke) {
          const bestJokeMessage = `The current best joke is: ${bestJoke.content}. It has a rating of ${bestJoke.elo_rating.toFixed(1)}.`;
          try {
            await this.cartesiaService.streamText(bestJokeMessage, true);
            const hasBestJokeAudio = await this.cartesiaService.waitForAudio(2000);
            if (hasBestJokeAudio) {
              await this.sendAudioToTwilio(twilioWs, streamSid, getSequence);
            }
          } catch (error) {
            console.error('[CARTESIA] Error sending best joke audio:', error);
          }
        }
      }

      try {
        await this.cartesiaService.streamText("Goodbye!", true);
        const hasGoodbyeAudio = await this.cartesiaService.waitForAudio(2000);
        if (hasGoodbyeAudio) {
          await this.sendAudioToTwilio(twilioWs, streamSid, getSequence);
        }
      } catch (error) {
        console.error('[CARTESIA] Error sending goodbye audio:', error);
      }

    } catch (error) {
      console.error('Error processing joke:', error);
      try {
        const errorMessage = "<emotion value='apologetic'/>Sorry, I couldn't process your joke. Please try again.";
        await this.cartesiaService.streamText(errorMessage, true);
        const hasErrorAudio = await this.cartesiaService.waitForAudio(2000);
        if (hasErrorAudio) {
          await this.sendAudioToTwilio(twilioWs, streamSid, getSequence);
        }
      } catch (streamError) {
        console.error('[CARTESIA] Error sending error message:', streamError);
      }
    }
  }

  stop(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

