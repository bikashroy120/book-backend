export interface MailMessage {
  to: string;
  subject: string;
  html: string;
}

export interface MailTransport {
  sendMail(message: MailMessage): Promise<void>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');
