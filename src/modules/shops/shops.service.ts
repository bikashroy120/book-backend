import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderChannel, Prisma, UserStatus } from '@prisma/client';
import { pageMeta, pageSkip } from '../../common/utils/pagination';
import { PrismaService } from '../../core/database/prisma.service';
import { CreateShopDTO, UpdateShopDTO } from './dto/create-shop.dto';
import { ShopsQueryDTO } from './dto/shops-query.dto';

const shopSelect = {
  id: true,
  name: true,
  shopType: true,
  ownerName: true,
  phone: true,
  whatsapp: true,
  district: true,
  area: true,
  address: true,
  commissionRate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ShopSelect;

type ShopCounterStats = {
  totalOrders: number;
  totalOrderValue: Prisma.Decimal;
  dueAmount: Prisma.Decimal;
};

function emptyCounterStats(): ShopCounterStats {
  return {
    totalOrders: 0,
    totalOrderValue: new Prisma.Decimal(0),
    dueAmount: new Prisma.Decimal(0),
  };
}

@Injectable()
export class ShopsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ShopsQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const baseWhere: Prisma.ShopWhereInput = {
      ...(query.shopType ? { shopType: query.shopType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { ownerName: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
              { area: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    let dueShopIds: string[] | undefined;
    if (query.dueOnly) {
      const dueGroups = await this.prisma.order.groupBy({
        by: ['shopId'],
        where: {
          channel: OrderChannel.COUNTER,
          shopId: { not: null },
        },
        having: {
          dueAmount: { _sum: { gt: new Prisma.Decimal(0) } },
        },
        _count: { _all: true },
      });
      dueShopIds = dueGroups.flatMap((group) =>
        group.shopId ? [group.shopId] : [],
      );
    }

    const where: Prisma.ShopWhereInput = {
      ...baseWhere,
      ...(dueShopIds ? { id: { in: dueShopIds } } : {}),
    };
    const [shops, total] = await Promise.all([
      this.prisma.shop.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          shopType: true,
          ownerName: true,
          phone: true,
          whatsapp: true,
          district: true,
          area: true,
          commissionRate: true,
          status: true,
        },
      }),
      this.prisma.shop.count({ where }),
    ]);

    const statsByShop = await this.getCounterOrderStats(
      shops.map((shop) => shop.id),
    );
    return {
      data: shops.map((shop) => ({
        ...shop,
        ...(statsByShop.get(shop.id) ?? emptyCounterStats()),
      })),
      meta: pageMeta(page, limit, total),
    };
  }

  async getSummary() {
    const [registeredShops, counterTotals] = await Promise.all([
      this.prisma.shop.count(),
      this.prisma.order.aggregate({
        where: { channel: OrderChannel.COUNTER },
        _sum: { total: true, paidAmount: true, dueAmount: true },
      }),
    ]);

    return {
      registeredShops,
      totalCounterSales: counterTotals._sum.total ?? new Prisma.Decimal(0),
      collectedAmount: counterTotals._sum.paidAmount ?? new Prisma.Decimal(0),
      totalDue: counterTotals._sum.dueAmount ?? new Prisma.Decimal(0),
    };
  }

  async getById(id: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { id },
      select: shopSelect,
    });
    if (!shop) throw new NotFoundException('Shop not found');

    const [counterStats, orders] = await Promise.all([
      this.prisma.order.aggregate({
        where: { shopId: id, channel: OrderChannel.COUNTER },
        _count: { _all: true },
        _sum: { total: true, paidAmount: true, dueAmount: true },
      }),
      this.prisma.order.findMany({
        where: { shopId: id, channel: OrderChannel.COUNTER },
        take: 10,
        orderBy: { placedAt: 'desc' },
        select: {
          id: true,
          orderNo: true,
          status: true,
          paymentStatus: true,
          total: true,
          paidAmount: true,
          dueAmount: true,
          placedAt: true,
          repName: true,
        },
      }),
    ]);

    return {
      ...shop,
      stats: {
        totalOrders: counterStats._count._all,
        totalOrderValue: counterStats._sum.total ?? new Prisma.Decimal(0),
        collectedAmount: counterStats._sum.paidAmount ?? new Prisma.Decimal(0),
        dueAmount: counterStats._sum.dueAmount ?? new Prisma.Decimal(0),
      },
      orders,
    };
  }

  async create(input: CreateShopDTO) {
    const duplicatePhone = await this.prisma.shop.findFirst({
      where: { phone: input.phone },
      select: { id: true },
    });
    const shop = await this.prisma.shop.create({
      data: {
        name: input.name,
        shopType: input.shopType,
        ownerName: input.ownerName,
        phone: input.phone,
        whatsapp: input.whatsapp,
        district: input.district,
        area: input.area,
        address: input.address,
        commissionRate: new Prisma.Decimal(input.commissionRate.toString()),
      },
      select: shopSelect,
    });

    return duplicatePhone
      ? {
          data: shop,
          message:
            'Shop created. Warning: another shop is already registered with this phone number.',
        }
      : shop;
  }

  async update(id: string, input: UpdateShopDTO) {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new BadRequestException('At least one shop field is required');
    }

    const data: Prisma.ShopUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.shopType !== undefined) data.shopType = input.shopType;
    if (input.ownerName !== undefined) data.ownerName = input.ownerName;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.whatsapp !== undefined) data.whatsapp = input.whatsapp;
    if (input.district !== undefined) data.district = input.district;
    if (input.area !== undefined) data.area = input.area;
    if (input.address !== undefined) data.address = input.address;
    if (input.commissionRate !== undefined) {
      data.commissionRate = new Prisma.Decimal(input.commissionRate.toString());
    }
    if (input.status !== undefined) data.status = input.status;

    try {
      return await this.prisma.shop.update({
        where: { id },
        data,
        select: shopSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Shop not found');
      }
      throw error;
    }
  }

  async delete(id: string) {
    return this.prisma.$transaction(async (transaction) => {
      const shop = await transaction.shop.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!shop) throw new NotFoundException('Shop not found');

      const orderCount = await transaction.order.count({
        where: { shopId: id },
      });
      if (orderCount > 0) {
        return transaction.shop.update({
          where: { id },
          data: { status: UserStatus.SUSPENDED },
          select: shopSelect,
        });
      }

      return transaction.shop.delete({
        where: { id },
        select: shopSelect,
      });
    });
  }

  async getOptions() {
    return this.prisma.shop.findMany({
      where: { status: UserStatus.ACTIVE },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        ownerName: true,
        commissionRate: true,
      },
    });
  }

  private async getCounterOrderStats(shopIds: string[]) {
    const stats = new Map<string, ShopCounterStats>();
    if (shopIds.length === 0) return stats;

    const groups = await this.prisma.order.groupBy({
      by: ['shopId'],
      where: {
        channel: OrderChannel.COUNTER,
        shopId: { in: shopIds },
      },
      _count: { _all: true },
      _sum: { total: true, dueAmount: true },
    });

    for (const group of groups) {
      if (!group.shopId) continue;
      stats.set(group.shopId, {
        totalOrders: group._count._all,
        totalOrderValue: group._sum.total ?? new Prisma.Decimal(0),
        dueAmount: group._sum.dueAmount ?? new Prisma.Decimal(0),
      });
    }
    return stats;
  }
}
