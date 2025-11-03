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
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this.ws) {
      this.disconnect();
    }

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
            const audioChunk = Buffer.from(message.data, 'base64');
            this.audioBuffer.push(audioChunk);
            console.log(`[CARTESIA] Received audio chunk: ${audioChunk.length} bytes (total: ${this.audioBuffer.length} chunks)`);
          } else if (message.done) {
            console.log('[CARTESIA] Audio generation complete');
          }
        } catch (error) {
          console.error('Error parsing Cartesia message:', error);
        }
      });
    });
  }

  async streamText(text: string, continueContext = false, retries = 3): Promise<void> {
    for (let attempt = 0; attempt < retries; attempt++) {
      if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        if (attempt < retries - 1) {
          console.log(`[CARTESIA] Connection not ready, attempting to reconnect (attempt ${attempt + 1}/${retries})...`);
          try {
            await this.connect();
          } catch (error) {
            if (attempt === retries - 1) {
              throw new Error(`Cartesia TTS WebSocket not connected after ${retries} attempts`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            continue;
          }
        } else {
          throw new Error('Cartesia TTS WebSocket not connected');
        }
      }

      try {
        const modelId = this.config.modelId || config.cartesia.modelId;
        const voiceId = this.config.voiceId || config.cartesia.voiceId;

        if (!this.contextId) {
          this.contextId = `context-${Date.now()}`;
        }

        this.audioBuffer = [];

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

        console.log(`[CARTESIA] Sending text: "${text}"`);
        this.ws.send(JSON.stringify(message));
        
        await new Promise(resolve => setTimeout(resolve, 100));
        return;
      } catch (error) {
        if (attempt === retries - 1) {
          throw error;
        }
        console.log(`[CARTESIA] Error sending text, retrying (attempt ${attempt + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  async waitForAudio(timeout: number = 3000): Promise<boolean> {
    const startTime = Date.now();
    let lastChunkTime = startTime;
    let lastChunkCount = 0;
    
    while (Date.now() - startTime < timeout) {
      const currentLength = this.audioBuffer.length;
      
      if (currentLength > lastChunkCount) {
        lastChunkTime = Date.now();
        lastChunkCount = currentLength;
      }
      
      if (currentLength > 0 && Date.now() - lastChunkTime > 300) {
        console.log(`[CARTESIA] Audio complete: ${currentLength} chunks`);
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    const hasAudio = this.audioBuffer.length > 0;
    if (hasAudio) {
      console.log(`[CARTESIA] Audio received (timeout): ${this.audioBuffer.length} chunks`);
    } else {
      console.warn('[CARTESIA] No audio received within timeout');
    }
    return hasAudio;
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

