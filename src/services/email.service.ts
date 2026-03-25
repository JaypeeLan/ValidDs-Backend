import { AppError } from '../middleware/error.middleware';

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

export const EmailService = {
  async sendEmail(input: SendEmailInput): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM;

    if (!apiKey || !from) {
      throw new AppError(500, 'Email service not configured', 'EMAIL_NOT_CONFIGURED');
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AppError(502, 'Failed to send email', 'EMAIL_SEND_FAILED', {
        status: res.status,
        body: text,
      });
    }
  },
};

