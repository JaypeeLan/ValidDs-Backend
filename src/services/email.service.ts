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

    if (!apiKey || !from || process.env.NODE_ENV === 'development') {
      console.log('\n' + '='.repeat(40));
      console.log('📬  EMAIL SENT (DEVELOPMENT)');
      console.log('='.repeat(40));
      console.log(`To:      ${input.to}`);
      console.log(`Subject: ${input.subject}`);

      // Extract numeric codes for easier viewing
      const codeMatch = input.html.match(/>(\d{6})</);
      if (codeMatch) {
        console.log('\n🔑  VERIFICATION CODE:');
        console.log('    ' + codeMatch[1]);
        console.log('');
      }

      console.log('--- HTML CONTENT ---');
      console.log(input.html);
      console.log('='.repeat(40) + '\n');

      if (process.env.NODE_ENV === 'development') return;
      throw new AppError(500, 'Email service not configured', 'EMAIL_NOT_CONFIGURED');
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'ValidDs-Backend/1.0 (+https://validds.com; email)',
        Accept: 'application/json',
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
