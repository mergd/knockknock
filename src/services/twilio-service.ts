import WebSocket from 'ws';
import http from 'http';
import { config } from '../config.js';
import { CartesiaTTSService } from './cartesia-service.js';
import { JokeRepository } from '../db/database.js';
import { processJokeFromRecording } from './voice-joke-service.js';

export class TwilioWebSocketService {
  private wss: WebSocket.Server | null = null;
  private server: http.Server | null = null;
  private cartesiaService: CartesiaTTSService;
  private jokeRepository: JokeRepository;

  constructor(cartesiaService: CartesiaTTSService, jokeRepository: JokeRepository) {
    this.cartesiaService = cartesiaService;
    this.jokeRepository = jokeRepository;
  }

  async start(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('Twilio WebSocket server is running');
      });

      this.wss = new WebSocket.Server({ server: this.server });

      this.wss.on('connection', (twilioWs, request) => {
        console.log(`Twilio WebSocket connection from ${request.socket.remoteAddress}`);
        this.handleTwilioConnection(twilioWs);
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
    let audioChunks: Buffer[] = [];

    twilioWs.on('message', async (message: WebSocket.Data) => {
      try {
        const msg = JSON.parse(message.toString());

        if (msg.event === 'start') {
          console.log('Twilio media stream started');
          streamSid = msg.start.streamSid;
          
          await this.cartesiaService.connect();
          
          const greeting = "Hi! Tell me a knockknock joke.";
          await this.cartesiaService.streamText(greeting, false);
          await this.sendAudioToTwilio(twilioWs, streamSid);

        } else if (msg.event === 'media') {
          const payload = msg.media.payload;
          const audioData = Buffer.from(payload, 'base64');
          audioChunks.push(audioData);

        } else if (msg.event === 'stop') {
          console.log('Twilio media stream stopped');
          if (streamSid && audioChunks.length > 0) {
            await this.processRecordedJoke(audioChunks, twilioWs, streamSid);
          }
          this.cartesiaService.disconnect();
        }
      } catch (error) {
        console.error('Error handling Twilio message:', error);
      }
    });

    twilioWs.on('close', () => {
      console.log('Twilio WebSocket disconnected');
      this.cartesiaService.disconnect();
    });

    twilioWs.on('error', (error) => {
      console.error('Twilio WebSocket error:', error);
    });
  }

  private async sendAudioToTwilio(twilioWs: WebSocket, streamSid: string) {
    const audioChunks = this.cartesiaService.getAudioChunks();
    
    for (const chunk of audioChunks) {
      const payload = chunk.toString('base64');
      twilioWs.send(JSON.stringify({
        event: 'media',
        streamSid: streamSid,
        media: {
          payload: payload,
        },
      }));
    }
  }

  private async saveAudioChunks(audioChunks: Buffer[]): Promise<string> {
    const audioBuffer = Buffer.concat(audioChunks);
    const tempFile = `/tmp/recording-${Date.now()}.wav`;
    await Bun.write(tempFile, audioBuffer);
    return `file://${tempFile}`;
  }

  private async processRecordedJoke(
    audioChunks: Buffer[],
    twilioWs: WebSocket,
    streamSid: string
  ) {
    try {
      await this.cartesiaService.streamText("Processing your joke...", true);
      await this.sendAudioToTwilio(twilioWs, streamSid);

      const recordingUrl = await this.saveAudioChunks(audioChunks);
      
      const { joke, rating } = await processJokeFromRecording(
        recordingUrl,
        this.jokeRepository
      );

      const responseMessage = `Thank you! Your joke has been rated ${rating.toFixed(1)}. `;
      await this.cartesiaService.streamText(responseMessage, true);
      await this.sendAudioToTwilio(twilioWs, streamSid);

      const bestJoke = this.jokeRepository.getBestJoke();
      if (bestJoke) {
        const bestJokeMessage = `The current best joke is: ${bestJoke.content}. It has a rating of ${bestJoke.elo_rating.toFixed(1)}.`;
        await this.cartesiaService.streamText(bestJokeMessage, true);
        await this.sendAudioToTwilio(twilioWs, streamSid);
      }

    } catch (error) {
      console.error('Error processing joke:', error);
      const errorMessage = "Sorry, I couldn't process your joke. Please try again.";
      await this.cartesiaService.streamText(errorMessage, true);
      await this.sendAudioToTwilio(twilioWs, streamSid);
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

