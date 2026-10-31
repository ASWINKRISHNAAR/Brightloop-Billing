import nodemailer from 'nodemailer';
import { config } from './config.js';
import { logger } from './logger.js';

export const mailTransporter = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: false, // MailHog uses plain SMTP on 1025
  tls: {
    rejectUnauthorized: false
  }
});

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  try {
    const info = await mailTransporter.sendMail({
      from: config.SMTP_FROM,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html
    });
    logger.info({ messageId: info.messageId, to: options.to }, 'Email dispatched via SMTP (MailHog)');
    return true;
  } catch (err) {
    logger.warn({ err, to: options.to }, 'Failed to dispatch email via SMTP (MailHog might be offline during testing)');
    return false;
  }
}
