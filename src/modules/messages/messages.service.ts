import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MessageStatus, Prisma } from '@prisma/client';
import { MailService } from '../../core/mail/mail.service';
import { PrismaService } from '../../core/database/prisma.service';
import { pageMeta, pageSkip } from '../../common/utils/pagination';
import type { AuthUser } from '../../common/types/auth-user';
import type { ContactMessageDTO } from './dto/contact-message.dto';
import type { MessagesQueryDTO } from './dto/messages-query.dto';
import type { ReplyMessageDTO } from './dto/reply-message.dto';

const messageSelect = {
  id: true,
  name: true,
  email: true,
  subject: true,
  message: true,
  status: true,
  reply: true,
  repliedById: true,
  repliedAt: true,
  createdAt: true,
  repliedBy: { select: { id: true, name: true } },
} satisfies Prisma.ContactMessageSelect;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async createContact(input: ContactMessageDTO) {
    if (input.website?.trim()) {
      throw new BadRequestException('Invalid contact submission');
    }
    const name = input.name.trim();
    const subject = input.subject.trim();
    const message = input.message.trim();
    if (!name || !subject || !message) {
      throw new BadRequestException(
        'name, subject, and message cannot be empty',
      );
    }
    return this.prisma.contactMessage.create({
      data: {
        name,
        email: input.email.trim(),
        subject,
        message,
      },
      select: { id: true, status: true, createdAt: true },
    });
  }

  async findAll(query: MessagesQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.ContactMessageWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { subject: { contains: query.search, mode: 'insensitive' } },
              { message: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.contactMessage.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: messageSelect,
      }),
      this.prisma.contactMessage.count({ where }),
    ]);
    return { data, meta: pageMeta(page, limit, total) };
  }

  async findById(id: string) {
    const message = await this.prisma.contactMessage.findUnique({
      where: { id },
      select: messageSelect,
    });
    if (!message) throw new NotFoundException('Message not found');
    return message;
  }

  async updateStatus(id: string, status: MessageStatus) {
    const result = await this.prisma.contactMessage.updateMany({
      where: { id },
      data: { status },
    });
    if (result.count !== 1) throw new NotFoundException('Message not found');
    return this.findById(id);
  }

  async reply(id: string, user: AuthUser, input: ReplyMessageDTO) {
    const reply = input.reply.trim();
    if (!reply) throw new BadRequestException('reply cannot be empty');
    const message = await this.prisma.contactMessage.findUnique({
      where: { id },
      select: { id: true, email: true, subject: true },
    });
    if (!message) throw new NotFoundException('Message not found');

    const subject = `Re: ${message.subject.replace(/[\r\n]+/g, ' ')}`;
    const replyHtml = escapeHtml(reply).replace(/\r?\n/g, '<br>');
    await this.mail.sendMail({
      to: message.email,
      subject,
      html: `<p>Reply to your message:</p><p>${replyHtml}</p>`,
    });

    const repliedAt = new Date();
    await this.prisma.contactMessage.update({
      where: { id },
      data: {
        reply,
        status: MessageStatus.REPLIED,
        repliedById: user.id,
        repliedAt,
      },
      select: { id: true },
    });
    return this.findById(id);
  }
}
