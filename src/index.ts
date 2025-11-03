import express from 'express';
import ngrok from 'ngrok';
import { config } from './config.js';
import { initDatabase, JokeRepository } from './db/database.js';
import { createRoutes } from './routes/index.js';
import { TwilioWebSocketService } from './services/twilio-service.js';
import { CartesiaTTSService } from './services/cartesia-service.js';
import twilio from 'twilio';

const app = express();

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('Query:', JSON.stringify(req.query, null, 2));
  next();
});

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

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('[ERROR]', err);
    console.error('Request path:', req.path);
    console.error('Request body:', req.body);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  });

  const port = config.server.port;
  app.listen(port, async () => {
    console.log(`Express server running on port ${port}`);

    const wsPort = await twilioWebSocketService.start(0);
    
    if (config.ngrok.url) {
      const publicUrl = config.ngrok.url;
      const wssUrl = publicUrl.replace('https://', 'wss://');
      
      console.log(`Using existing ngrok tunnel: ${publicUrl}`);
      console.log(`WebSocket server running on port ${wsPort}`);
      console.log(`WebSocket URL: ${wssUrl}`);
      console.log(`\nConfigure your Twilio number webhook to: ${publicUrl}/webhook/twilio`);
    } else if (config.ngrok.authToken) {
      try {
        await ngrok.authtoken(config.ngrok.authToken);
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
      console.log(`WebSocket server running on port ${wsPort}`);
      console.log('Note: ngrok not configured. Set NGROK_URL or NGROK_AUTH_TOKEN in .env for local development.');
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

