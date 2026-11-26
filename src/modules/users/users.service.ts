import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  UserRole,
  UserStatus,
  DeliveryStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../core/database/prisma.service';
import { MailService } from '../../core/mail/mail.service';
import type { AuthUser } from '../../common/types/auth-user';
import { pageMeta, pageSkip } from '../../common/utils/pagination';
import { randomToken } from '../../common/utils/crypto';
import type { ChangePasswordDTO } from './dto/change-password.dto';
import type { ChangeUserRoleDTO } from './dto/change-user-role.dto';
import type { ChangeUserStatusDTO } from './dto/change-user-status.dto';
import type { CreateStaffDTO } from './dto/create-staff.dto';
import type { UpdateMeDTO } from './dto/update-me.dto';
import type { UsersQueryDTO } from './dto/users-query.dto';

const userProfileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  avatarUrl: true,
  language: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const staffUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  avatarUrl: true,
  language: true,
  status: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userProfileSelect,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  getMe(id: string) {
    return this.findById(id);
  }

  async updateMe(id: string, input: UpdateMeDTO) {
    if (
      input.name === undefined &&
      input.phone === undefined &&
      input.avatarUrl === undefined &&
      input.language === undefined
    ) {
      throw new BadRequestException('At least one profile field is required');
    }

    if (input.phone !== undefined && input.phone !== null) {
      const owner = await this.prisma.user.findUnique({
        where: { phone: input.phone },
        select: { id: true },
      });
      if (owner && owner.id !== id) {
        throw new ConflictException('Phone number is already in use');
      }
    }

    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;
    if (input.language !== undefined) data.language = input.language;

    return this.prisma.user.update({
      where: { id },
      data,
      select: userProfileSelect,
    });
  }

  async changePassword(id: string, input: ChangePasswordDTO) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { password: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!(await bcrypt.compare(input.currentPassword, user.password))) {
      throw new BadRequestException('Current password is incorrect');
    }

    const password = await bcrypt.hash(input.newPassword, 12);
    await this.prisma.user.update({
      where: { id },
      data: { password },
    });
    return { data: null, message: 'Password changed successfully' };
  }

  async deleteAvatar(id: string) {
    await this.prisma.user.update({
      where: { id },
      data: { avatarUrl: null },
    });
    return { data: null, message: 'Avatar removed successfully' };
  }

  async findAll(query: UsersQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          ...staffUserSelect,
          _count: { select: { orders: true, wishlist: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const userIds = users.map((user) => user.id);
    const totalSpentByUser = new Map<string, Prisma.Decimal>();
    const deliveredCountByUser = new Map<string, number>();

    if (userIds.length > 0) {
      const [spending, deliveries] = await Promise.all([
        this.prisma.order.groupBy({
          by: ['customerId'],
          where: {
            customerId: { in: userIds },
            status: { not: OrderStatus.CANCELLED },
          },
          _sum: { total: true },
        }),
        this.prisma.order.groupBy({
          by: ['customerId'],
          where: {
            customerId: { in: userIds },
            deliveryStatus: DeliveryStatus.DELIVERED,
          },
          _count: { _all: true },
        }),
      ]);

      for (const group of spending) {
        if (group.customerId && group._sum.total) {
          totalSpentByUser.set(group.customerId, group._sum.total);
        }
      }
      for (const group of deliveries) {
        if (group.customerId) {
          deliveredCountByUser.set(group.customerId, group._count._all);
        }
      }
    }

    const data = users.map((user) => {
      const orderCount = user._count.orders;
      const deliveredCount = deliveredCountByUser.get(user.id) ?? 0;
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatarUrl: user.avatarUrl,
        status: user.status,
        createdAt: user.createdAt,
        orderCount,
        totalSpent: totalSpentByUser.get(user.id) ?? new Prisma.Decimal(0),
        wishlistCount: user._count.wishlist,
        deliveryRate:
          orderCount === 0
            ? 0
            : Number(((deliveredCount / orderCount) * 100).toFixed(2)),
      };
    });

    return { data, meta: pageMeta(page, limit, total) };
  }

  async getSummary() {
    const [totalUsers, totalOrders, sales, deliveredOrders] = await Promise.all(
      [
        this.prisma.user.count(),
        this.prisma.order.count(),
        this.prisma.order.aggregate({
          where: { status: { not: OrderStatus.CANCELLED } },
          _sum: { total: true },
        }),
        this.prisma.order.count({
          where: { deliveryStatus: DeliveryStatus.DELIVERED },
        }),
      ],
    );

    return {
      totalUsers,
      totalOrders,
      totalSales: sales._sum.total ?? new Prisma.Decimal(0),
      avgDeliveryRate:
        totalOrders === 0
          ? 0
          : Number(((deliveredOrders / totalOrders) * 100).toFixed(2)),
    };
  }

  async getAdminUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...userProfileSelect,
        addresses: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            fullName: true,
            phone: true,
            division: true,
            district: true,
            upazila: true,
            details: true,
            type: true,
            isDefault: true,
            createdAt: true,
          },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            orderNo: true,
            status: true,
            deliveryStatus: true,
            total: true,
            createdAt: true,
          },
        },
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async createStaff(actor: AuthUser, input: CreateStaffDTO) {
    if (input.role === UserRole.ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only a super admin can create admins');
    }

    const temporaryPassword = `A1${randomToken(18)}`;
    const password = await bcrypt.hash(temporaryPassword, 12);
    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        ...(input.phone ? { phone: input.phone } : {}),
        password,
        role: input.role,
      },
      select: staffUserSelect,
    });

    const loginUrl = new URL(
      '/login',
      this.config.getOrThrow<string>('FRONTEND_URL'),
    );
    await this.mail.sendMail({
      to: user.email,
      subject: 'Your Hosonta Prokashon staff account',
      html: `<p>Your staff account is ready.</p><p>Temporary password: <strong>${temporaryPassword}</strong></p><p><a href="${loginUrl.toString()}">Sign in</a></p>`,
    });

    return user;
  }

  async changeStatus(actor: AuthUser, id: string, input: ChangeUserStatusDTO) {
    return this.prisma.$transaction(
      async (transaction) => {
        const target = await transaction.user.findUnique({
          where: { id },
          select: { id: true, role: true, status: true },
        });
        if (!target) {
          throw new NotFoundException('User not found');
        }
        this.assertCanManageTarget(actor, target);

        if (actor.id === target.id && input.status === UserStatus.SUSPENDED) {
          throw new ForbiddenException('You cannot suspend your own account');
        }

        if (
          target.role === UserRole.SUPER_ADMIN &&
          target.status === UserStatus.ACTIVE &&
          input.status === UserStatus.SUSPENDED
        ) {
          const activeSuperAdmins = await transaction.user.count({
            where: { role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE },
          });
          if (activeSuperAdmins <= 1) {
            throw new ConflictException(
              'At least one active super admin must remain',
            );
          }
        }

        return transaction.user.update({
          where: { id },
          data: { status: input.status },
          select: userProfileSelect,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async changeRole(actor: AuthUser, id: string, input: ChangeUserRoleDTO) {
    if (actor.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only a super admin can change user roles');
    }
    if (actor.id === id) {
      throw new ForbiddenException('You cannot change your own role');
    }

    return this.prisma.$transaction(
      async (transaction) => {
        const target = await transaction.user.findUnique({
          where: { id },
          select: { id: true, role: true, status: true },
        });
        if (!target) {
          throw new NotFoundException('User not found');
        }
        this.assertCanManageTarget(actor, target);

        if (
          target.role === UserRole.SUPER_ADMIN &&
          input.role !== UserRole.SUPER_ADMIN
        ) {
          const [superAdminCount, activeSuperAdminCount] = await Promise.all([
            transaction.user.count({
              where: { role: UserRole.SUPER_ADMIN },
            }),
            transaction.user.count({
              where: { role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE },
            }),
          ]);
          if (
            superAdminCount <= 1 ||
            (target.status === UserStatus.ACTIVE && activeSuperAdminCount <= 1)
          ) {
            throw new ConflictException(
              'At least one active super admin must remain',
            );
          }
        }

        return transaction.user.update({
          where: { id },
          data: { role: input.role },
          select: userProfileSelect,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private assertCanManageTarget(
    actor: AuthUser,
    target: { id: string; role: UserRole },
  ): void {
    if (actor.role === UserRole.ADMIN && target.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Admins cannot manage super admins');
    }
  }
}
