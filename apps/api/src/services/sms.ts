import twilio from 'twilio';
import { logger } from '../lib/logger';

let twilioClient: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!twilioClient) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;

    if (!sid || !token || sid.startsWith('AC') === false) {
      logger.warn('Twilio not configured — SMS will be logged only (dev mode)');
      return null;
    }
    twilioClient = twilio(sid, token);
  }
  return twilioClient;
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  const client = getClient();

  if (!client) {
    // Dev mode: just log the SMS
    logger.info('[SMS DEV MODE]', { to, body });
    return true;
  }

  try {
    const message = await client.messages.create({
      body,
      to,
      from: process.env.TWILIO_PHONE_NUMBER!,
    });
    logger.info('SMS sent', { sid: message.sid, to });
    return true;
  } catch (err) {
    logger.error('SMS send failed', { to, error: (err as Error).message });
    return false;
  }
}
