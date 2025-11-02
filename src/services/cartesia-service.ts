import WebSocket from 'ws';
import { config } from '../config.js';

export type CartesiaTTSConfig = {
  modelId?: string;
  voiceId?: string;
};

export class CartesiaTTSService {
  private ws: WebSocket | null = null;
  private audioBuffer: Buffer[] = [];
  private isConnected = false;
  private contextId: string | null = null;

  constructor(private config: CartesiaTTSConfig = {}) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const modelId = this.config.modelId || config.cartesia.modelId;
      const voiceId = this.config.voiceId || config.cartesia.voiceId;
      const url = `wss://api.cartesia.ai/tts/websocket?api_key=${config.cartesia.apiKey}&cartesia_version=2024-11-13`;

      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        console.log('Connected to Cartesia TTS WebSocket');
        this.isConnected = true;
        
        const initialMessage = {
          model_id: modelId,
          transcript: '',
          voice: {
            mode: 'id',
            id: voiceId,
          },
          output_format: {
            container: 'raw',
            encoding: 'pcm_mulaw',
            sample_rate: 8000,
          },
        };

        this.ws!.send(JSON.stringify(initialMessage));
        resolve();
      });

      this.ws.on('error', (error) => {
        console.error('Cartesia TTS WebSocket error:', error);
        this.isConnected = false;
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('Cartesia TTS WebSocket closed');
        this.isConnected = false;
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.data) {
            this.audioBuffer.push(Buffer.from(message.data, 'base64'));
          }
        } catch (error) {
          console.error('Error parsing Cartesia message:', error);
        }
      });
    });
  }

  async streamText(text: string, continueContext = false): Promise<void> {
    if (!this.isConnected || !this.ws) {
      throw new Error('Cartesia TTS WebSocket not connected');
    }

    const modelId = this.config.modelId || config.cartesia.modelId;
    const voiceId = this.config.voiceId || config.cartesia.voiceId;

    if (!this.contextId) {
      this.contextId = `context-${Date.now()}`;
    }

    const message = {
      model_id: modelId,
      transcript: text,
      voice: {
        mode: 'id',
        id: voiceId,
      },
      context_id: this.contextId,
      continue: continueContext,
      output_format: {
        container: 'raw',
        encoding: 'pcm_mulaw',
        sample_rate: 8000,
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  getAudioChunks(): Buffer[] {
    const chunks = [...this.audioBuffer];
    this.audioBuffer = [];
    return chunks;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.contextId = null;
    this.audioBuffer = [];
  }

  isConnectedToService(): boolean {
    return this.isConnected;
  }
}

