# KnockKnock Joke Service

A phone-based knockknock joke service with AI-powered ELO rating system.

## Features

- Receive phone calls via Twilio
- Record and transcribe knockknock jokes
- Rate jokes using AI-powered head-to-head comparisons
- Update ELO ratings based on comparisons
- Retrieve the best-rated joke
- Real-time audio streaming with Cartesia TTS

## Prerequisites

- Bun runtime installed
- Twilio account with phone number
- Cartesia API key
- OpenAI API key (for transcription and joke comparisons)
- ngrok account (for local development)

## Setup

1. Clone the repository and install dependencies:

```bash
bun install
```

2. Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

3. Configure your environment variables:
   - `TWILIO_ACCOUNT_SID`: Your Twilio Account SID
   - `TWILIO_AUTH_TOKEN`: Your Twilio Auth Token
   - `TWILIO_PHONE_NUMBER`: Your Twilio phone number
   - `CARTESIA_API_KEY`: Your Cartesia API key
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `NGROK_AUTH_TOKEN`: Your ngrok auth token (optional, for local dev)

4. Run the application:

```bash
bun run dev
```

## Configuration

The application will:
- Start an Express server on port 3000 (or PORT from .env)
- Start a WebSocket server for Twilio media streams
- If ngrok is configured, create a tunnel and display the public URL

## Twilio Setup

1. In your Twilio console, configure your phone number's webhook:
   - Voice webhook URL: `https://your-domain.com/webhook/twilio`
   - Method: POST

2. For WebSocket streaming (optional):
   - Configure your Twilio number to use Media Streams
   - Set the WebSocket URL to the ngrok/public URL

## Usage

1. Call your Twilio phone number
2. You'll be prompted to tell a knockknock joke
3. The system will:
   - Record your joke
   - Transcribe it
   - Compare it against existing jokes
   - Update ELO ratings
   - Tell you the rating and the current best joke

## API Endpoints

- `POST /webhook/twilio` - Twilio webhook handler
- `GET /best-joke` - Get the top-rated joke
- `GET /jokes?limit=10` - Get top jokes

## Database

SQLite database is stored at `./data/jokes.db` by default. The database schema includes:
- `id`: Primary key
- `content`: Joke text
- `elo_rating`: Current ELO rating (default: 1500)
- `created_at`: Timestamp

## Development

```bash
# Run in development mode
bun run dev

# Type check
bun run type-check

# Build
bun run build
```

## Notes

- The service uses GPT-4o-mini for fast joke comparisons
- ELO ratings start at 1500 and use a K-factor of 32
- New jokes are compared against the top 5 existing jokes
- Cartesia TTS provides real-time audio streaming with continuations

