import express from 'express';
import ngrok from 'ngrok';
import { config } from './config.js';
import { initDatabase, JokeRepository } from './db/database.js';
import { createRoutes } from './routes/index.js';
import { TwilioWebSocketService } from './services/twilio-service.js';
import { CartesiaTTSService } from './services/cartesia-service.js';
import twilio from 'twilio';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let db: any;
let jokeRepository: JokeRepository;
let twilioWebSocketService: TwilioWebSocketService;
let cartesiaService: CartesiaTTSService;
let twilioClient: twilio.Twilio;

async function main() {
  console.log('Initializing database...');
  db = await initDatabase();
  jokeRepository = new JokeRepository(db);

  console.log('Initializing Cartesia TTS service...');
  cartesiaService = new CartesiaTTSService();

  console.log('Initializing Twilio WebSocket service...');
  twilioWebSocketService = new TwilioWebSocketService(cartesiaService, jokeRepository);

  twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

  app.use(createRoutes(jokeRepository));

  const port = config.server.port;
  app.listen(port, async () => {
    console.log(`Express server running on port ${port}`);

    if (config.ngrok.authToken) {
      try {
        await ngrok.authtoken(config.ngrok.authToken);
        const wsPort = await twilioWebSocketService.start(0);
        const publicUrl = await ngrok.connect(wsPort);
        const wssUrl = publicUrl.replace('https://', 'wss://');
        
        console.log(`ngrok tunnel established: ${wssUrl}`);
        console.log(`WebSocket server running on port ${wsPort}`);
        console.log(`\nConfigure your Twilio number webhook to: ${publicUrl}/webhook/twilio`);
      } catch (error) {
        console.error('Error setting up ngrok:', error);
        console.log('Running without ngrok tunnel. For production, configure your own public URL.');
      }
    } else {
      const wsPort = await twilioWebSocketService.start(0);
      console.log(`WebSocket server running on port ${wsPort}`);
      console.log('Note: ngrok not configured. Set NGROK_AUTH_TOKEN in .env for local development.');
    }
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  twilioWebSocketService?.stop();
  cartesiaService?.disconnect();
  db?.close();
  process.exit(0);
});

