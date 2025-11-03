import dotenv from "dotenv";

dotenv.config();

export const config = {
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
    authToken: process.env.TWILIO_AUTH_TOKEN!,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER!,
  },
  cartesia: {
    apiKey: process.env.CARTESIA_API_KEY!,
    modelId: process.env.CARTESIA_MODEL_ID || "sonic-3",
    voiceId:
      process.env.CARTESIA_VOICE_ID || "a0e99841-438c-4a64-b679-ae501e7d6091",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY!,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },
  database: {
    path: process.env.DATABASE_PATH || "./data/jokes.db",
  },
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
  },
  ngrok: {
    authToken: process.env.NGROK_AUTH_TOKEN,
    url: process.env.NGROK_URL,
  },
  elo: {
    initialRating: 1500,
    kFactor: 32,
    comparisonSampleSize: 5,
  },
};

function validateConfig() {
  const required = [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
    "CARTESIA_API_KEY",
    "OPENAI_API_KEY",
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}

validateConfig();
