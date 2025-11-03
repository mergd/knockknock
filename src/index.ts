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

app.use(express.static('public'));

let db: any;
let jokeRepository: JokeRepository;
let twilioWebSocketService: TwilioWebSocketService;
let cartesiaService: CartesiaTTSService;
let twilioClient: twilio.Twilio;
let wsServerUrl: string = '';

async function main() {
  console.log('Initializing database...');
  db = await initDatabase();
  jokeRepository = new JokeRepository(db);

  console.log('Initializing Cartesia TTS service...');
  cartesiaService = new CartesiaTTSService();

  console.log('Initializing Twilio WebSocket service...');
  twilioWebSocketService = new TwilioWebSocketService(cartesiaService, jokeRepository);

  twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

  app.use(createRoutes(jokeRepository, () => wsServerUrl));

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('[ERROR]', err);
    console.error('Request path:', req.path);
    console.error('Request body:', req.body);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  });

  const port = config.server.port;
  const wsPort = await twilioWebSocketService.start(port, app);
  console.log(`WebSocket server started on port ${wsPort}`);
  wsServerUrl = `wss://localhost:${wsPort}`;
  
  let publicUrl: string | null = null;
  
  if (config.ngrok.url) {
    publicUrl = config.ngrok.url;
    const wssUrl = publicUrl.replace('https://', 'wss://');
    wsServerUrl = wssUrl;
    
    console.log(`Using configured ngrok URL: ${publicUrl}`);
    console.log(`WebSocket URL: ${wsServerUrl}`);
  } else if (config.ngrok.authToken) {
    try {
      await ngrok.authtoken(config.ngrok.authToken);
      publicUrl = await ngrok.connect(wsPort);
      const wssUrl = publicUrl.replace('https://', 'wss://');
      wsServerUrl = wssUrl;
      
      console.log(`ngrok tunnel established: ${publicUrl}`);
      console.log(`WebSocket URL: ${wsServerUrl}`);
    } catch (error: any) {
      const errorMsg = error?.message || error?.code || 'Unknown error';
      console.log(`Could not create ngrok tunnel (${errorMsg}). Trying to detect existing tunnel...`);
      
      try {
        const ngrokApi = await fetch('http://localhost:4040/api/tunnels').then(r => r.json());
        if (ngrokApi.tunnels && ngrokApi.tunnels.length > 0) {
          publicUrl = ngrokApi.tunnels[0].public_url;
          wsServerUrl = publicUrl.replace('https://', 'wss://');
          console.log(`Detected existing ngrok tunnel: ${publicUrl}`);
          console.log(`WebSocket URL: ${wsServerUrl}`);
        } else {
          console.log('No existing ngrok tunnel found.');
        }
      } catch (e) {
        console.log('Could not detect ngrok tunnel (ngrok API not available).');
      }
    }
  } else {
    try {
      const ngrokApi = await fetch('http://localhost:4040/api/tunnels').then(r => r.json());
      if (ngrokApi.tunnels && ngrokApi.tunnels.length > 0) {
        publicUrl = ngrokApi.tunnels[0].public_url;
        wsServerUrl = publicUrl.replace('https://', 'wss://');
        console.log(`Detected existing ngrok tunnel: ${publicUrl}`);
        console.log(`WebSocket URL: ${wsServerUrl}`);
      } else {
        console.log('No ngrok tunnel detected. Set NGROK_URL or NGROK_AUTH_TOKEN in .env');
      }
    } catch (e) {
      console.log('No ngrok tunnel detected. Set NGROK_URL or NGROK_AUTH_TOKEN in .env');
    }
  }
  
  if (publicUrl) {
    console.log(`\n✅ Configure your Twilio number webhook to: ${publicUrl}/webhook/twilio`);
    console.log(`✅ WebSocket stream URL: ${wsServerUrl}`);
  } else {
    console.log(`\n⚠️  No public URL available. WebSocket URL: ${wsServerUrl}`);
  }
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

