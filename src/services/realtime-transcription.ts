import { config } from '../config.js';

export interface TranscriptionChunk {
  text: string;
  timestamp: number;
}

export class RealtimeTranscriptionService {
  private audioBuffer: Buffer[] = [];
  private lastTranscriptionTime: number = 0;
  private transcriptionInterval: number = 1500; // Transcribe every 1.5 seconds
  private silenceThreshold: number = 800; // 0.8 seconds of silence to trigger transcription
  private lastAudioActivity: number = 0;

  addAudioChunk(chunk: Buffer): void {
    this.audioBuffer.push(chunk);
    this.lastAudioActivity = Date.now();
  }

  hasRecentAudio(): boolean {
    return Date.now() - this.lastAudioActivity < 500;
  }

  getSilenceDuration(): number {
    return Date.now() - this.lastAudioActivity;
  }

  clearBuffer(): void {
    this.audioBuffer = [];
  }

  private mulawToLinear(mulawBuffer: Buffer): Buffer {
    const linearBuffer = Buffer.alloc(mulawBuffer.length * 2);
    for (let i = 0; i < mulawBuffer.length; i++) {
      let mulawByte = mulawBuffer[i];
      
      mulawByte = (~mulawByte) & 0xFF;
      
      const sign = (mulawByte & 0x80) ? -1 : 1;
      const exponent = (mulawByte & 0x70) >> 4;
      const mantissa = (mulawByte & 0x0F) | 0x10;
      
      let linear = ((mantissa << (exponent + 3)) - 132) * sign;
      linear = linear << 2;
      
      linear = Math.max(-32768, Math.min(32767, linear));
      
      linearBuffer.writeInt16LE(linear, i * 2);
    }
    return linearBuffer;
  }

  private createWavFile(pcmBuffer: Buffer, sampleRate: number = 8000): Buffer {
    const wavHeader = Buffer.alloc(44);
    const dataLength = pcmBuffer.length;
    const fileLength = dataLength + 36;
    
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(fileLength, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(1, 22);
    wavHeader.writeUInt32LE(sampleRate, 24);
    wavHeader.writeUInt32LE(sampleRate * 2, 28);
    wavHeader.writeUInt16LE(2, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(dataLength, 40);
    
    return Buffer.concat([wavHeader, pcmBuffer]);
  }

  async transcribeBuffer(): Promise<string> {
    if (this.audioBuffer.length === 0) {
      return '';
    }

    try {
      const mulawBuffer = Buffer.concat(this.audioBuffer);
      
      if (mulawBuffer.length < 100) {
        return '';
      }

      const pcmBuffer = this.mulawToLinear(mulawBuffer);
      const wavBuffer = this.createWavFile(pcmBuffer, 8000);
      
      const file = new File(
        [new Uint8Array(wavBuffer)],
        'audio.wav',
        { type: 'audio/wav' }
      );

      const formData = new FormData();
      formData.append('file', file);
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.openai.apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Transcription API error:', response.status, errorText);
        throw new Error(`Transcription failed: ${response.statusText}`);
      }

      const result = await response.json();
      return result.text || '';
    } catch (error) {
      console.error('Transcription error:', error);
      return '';
    }
  }

  async shouldTranscribe(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastTranscriptionTime >= this.transcriptionInterval) {
      this.lastTranscriptionTime = now;
      return true;
    }
    return false;
  }

  getBufferedAudio(): Buffer {
    return Buffer.concat(this.audioBuffer);
  }

  async shouldTranscribe(): Promise<boolean> {
    const now = Date.now();
    const silenceDuration = this.getSilenceDuration();
    
    if (silenceDuration > this.silenceThreshold && this.audioBuffer.length > 0) {
      this.lastTranscriptionTime = now;
      return true;
    }
    
    if (now - this.lastTranscriptionTime >= this.transcriptionInterval && this.audioBuffer.length > 0) {
      this.lastTranscriptionTime = now;
      return true;
    }
    
    return false;
  }

  reset(): void {
    this.audioBuffer = [];
    this.lastTranscriptionTime = 0;
    this.lastAudioActivity = Date.now();
  }
}

