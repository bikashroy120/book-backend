import { BadRequestException } from '@nestjs/common';
import { MessageStatus, Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user';
import { MailService } from '../../core/mail/mail.service';
import { PrismaService } from '../../core/database/prisma.service';
import { MessagesService } from './messages.service';

describe('MessagesService', () => {
  it('rejects a contact submission when the honeypot is filled', async () => {
    const create = jest.fn();
    const prisma = {
      contactMessage: { create },
    } as unknown as PrismaService;
    const service = new MessagesService(prisma, {} as MailService);

    await expect(
      service.createContact({
        name: 'Reader',
        email: 'reader@example.test',
        subject: 'Question',
        message: 'Hello',
        website: 'https://bot.example.test',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('stores valid public contact submissions without the honeypot field', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'message-1' });
    const prisma = {
      contactMessage: { create },
    } as unknown as PrismaService;
    const service = new MessagesService(prisma, {} as MailService);

    await service.createContact({
      name: ' Reader ',
      email: 'reader@example.test',
      subject: ' Question ',
      message: ' Hello ',
      website: '',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Reader',
          email: 'reader@example.test',
          subject: 'Question',
          message: 'Hello',
        },
      }),
    );
  });

  it('emails escaped replies and marks messages as replied', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'message-1',
        email: 'reader@example.test',
        subject: 'A <question>',
      })
      .mockResolvedValueOnce({
        id: 'message-1',
        status: MessageStatus.REPLIED,
      });
    let updateData: Prisma.ContactMessageUpdateInput | undefined;
    const update = jest
      .fn()
      .mockImplementation(
        (args: { data: Prisma.ContactMessageUpdateInput }) => {
          updateData = args.data;
          return Promise.resolve({ id: 'message-1' });
        },
      );
    const prisma = {
      contactMessage: { findUnique, update },
    } as unknown as PrismaService;
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const mail = { sendMail } as unknown as MailService;
    const service = new MessagesService(prisma, mail);
    const user: AuthUser = {
      id: 'staff-1',
      email: 'staff@example.test',
      role: UserRole.ADMIN,
    };

    await service.reply('message-1', user, { reply: '<script>no</script>' });

    expect(sendMail).toHaveBeenCalledWith({
      to: 'reader@example.test',
      subject: 'Re: A <question>',
      html: '<p>Reply to your message:</p><p>&lt;script&gt;no&lt;/script&gt;</p>',
    });
    expect(updateData).toMatchObject({
      reply: '<script>no</script>',
      status: MessageStatus.REPLIED,
      repliedById: 'staff-1',
    });
    expect(updateData?.repliedAt).toBeInstanceOf(Date);
  });
});
