export enum ConversationState {
  WAITING_FOR_KNOCKKNOCK = 'waiting_for_knockknock',
  WAITING_FOR_NAME = 'waiting_for_name',
  WAITING_FOR_PUNCHLINE = 'waiting_for_punchline',
  COMPLETED = 'completed',
}

export interface ConversationContext {
  state: ConversationState;
  name?: string;
  punchline?: string;
  fullTranscript: string;
}

export function createConversationContext(): ConversationContext {
  return {
    state: ConversationState.WAITING_FOR_KNOCKKNOCK,
    fullTranscript: '',
  };
}

export function detectKnockKnock(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return normalized.includes('knock knock') || 
         normalized.includes('knockknock') ||
         normalized.includes('knock-knock') ||
         normalized === 'knock' ||
         normalized.startsWith('knock');
}

export function updateConversationState(
  context: ConversationContext,
  transcript: string
): ConversationContext {
  const normalized = transcript.toLowerCase().trim();
  context.fullTranscript += ' ' + transcript;

  switch (context.state) {
    case ConversationState.WAITING_FOR_KNOCKKNOCK:
      if (detectKnockKnock(transcript)) {
        context.state = ConversationState.WAITING_FOR_NAME;
        return context;
      }
      break;

    case ConversationState.WAITING_FOR_NAME:
      if (transcript.length > 0 && !detectKnockKnock(transcript)) {
        context.name = transcript.trim();
        context.state = ConversationState.WAITING_FOR_PUNCHLINE;
        console.log(`[STATE] Name captured: "${context.name}"`);
        return context;
      }
      break;

    case ConversationState.WAITING_FOR_PUNCHLINE:
      if (transcript.length > 0) {
        context.punchline = transcript;
        context.state = ConversationState.COMPLETED;
        return context;
      }
      break;
  }

  return context;
}

export function getResponseForState(
  context: ConversationContext,
  transcript: string
): string | null {
  switch (context.state) {
    case ConversationState.WAITING_FOR_KNOCKKNOCK:
      if (detectKnockKnock(transcript)) {
        updateConversationState(context, transcript);
        return "Who's there?";
      }
      return null;

    case ConversationState.WAITING_FOR_NAME:
      if (transcript.length > 0 && !detectKnockKnock(transcript)) {
        updateConversationState(context, transcript);
        return `${context.name} who?`;
      }
      return null;

    case ConversationState.WAITING_FOR_PUNCHLINE:
      return null;

    case ConversationState.COMPLETED:
      return null;
  }

  return null;
}

