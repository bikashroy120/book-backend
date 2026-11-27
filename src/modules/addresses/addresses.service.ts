import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AddressType, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import type { AddressDTO, CreateAddressDTO } from './dto/address.dto';

const addressSelect = {
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
} as const;

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: addressSelect,
    });
  }

  async create(userId: string, input: CreateAddressDTO) {
    return this.prisma.$transaction(
      async (transaction) => {
        const addressCount = await transaction.address.count({
          where: { userId },
        });
        if (addressCount >= 10) {
          throw new ConflictException(
            'A user cannot have more than 10 addresses',
          );
        }

        const makeDefault = input.isDefault === true || addressCount === 0;
        if (makeDefault) {
          await transaction.address.updateMany({
            where: { userId, isDefault: true },
            data: { isDefault: false },
          });
        }

        return transaction.address.create({
          data: {
            userId,
            fullName: input.fullName,
            phone: input.phone,
            division: input.division,
            district: input.district,
            upazila: input.upazila,
            details: input.details,
            type: input.type ?? AddressType.HOME,
            isDefault: makeDefault,
          },
          select: addressSelect,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async update(userId: string, addressId: string, input: AddressDTO) {
    this.assertAddressFields(input);
    const existing = await this.findOwnedAddress(userId, addressId);
    const data: Prisma.AddressUpdateInput = {};
    if (input.fullName !== undefined) data.fullName = input.fullName;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.division !== undefined) data.division = input.division;
    if (input.district !== undefined) data.district = input.district;
    if (input.upazila !== undefined) data.upazila = input.upazila;
    if (input.details !== undefined) data.details = input.details;
    if (input.type !== undefined) data.type = input.type;
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;

    if (input.isDefault === true) {
      return this.prisma.$transaction(async (transaction) => {
        await transaction.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
        return transaction.address.update({
          where: { id: existing.id, userId },
          data: { ...data, isDefault: true },
          select: addressSelect,
        });
      });
    }

    if (input.isDefault === false && existing.isDefault) {
      return this.prisma.$transaction(async (transaction) => {
        const nextDefault = await transaction.address.findFirst({
          where: { userId, id: { not: existing.id } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        const updated = await transaction.address.update({
          where: { id: existing.id, userId },
          data: { ...data, isDefault: nextDefault ? false : true },
          select: addressSelect,
        });
        if (nextDefault) {
          await transaction.address.update({
            where: { id: nextDefault.id, userId },
            data: { isDefault: true },
          });
        }
        return updated;
      });
    }

    return this.prisma.address.update({
      where: { id: existing.id, userId },
      data,
      select: addressSelect,
    });
  }

  async setDefault(userId: string, addressId: string) {
    await this.findOwnedAddress(userId, addressId);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
      return transaction.address.update({
        where: { id: addressId, userId },
        data: { isDefault: true },
        select: addressSelect,
      });
    });
  }

  async delete(userId: string, addressId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const address = await transaction.address.findFirst({
        where: { id: addressId, userId },
        select: { id: true, isDefault: true },
      });
      if (!address) {
        throw new NotFoundException('Address not found');
      }

      await transaction.address.delete({ where: { id: address.id } });

      if (address.isDefault) {
        const nextDefault = await transaction.address.findFirst({
          where: { userId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        if (nextDefault) {
          await transaction.address.update({
            where: { id: nextDefault.id, userId },
            data: { isDefault: true },
          });
        }
      }

      return { data: null, message: 'Address deleted successfully' };
    });
  }

  private async findOwnedAddress(userId: string, addressId: string) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
      select: addressSelect,
    });
    if (!address) {
      throw new NotFoundException('Address not found');
    }
    return address;
  }

  private assertAddressFields(input: AddressDTO): void {
    if (
      input.fullName === undefined &&
      input.phone === undefined &&
      input.division === undefined &&
      input.district === undefined &&
      input.upazila === undefined &&
      input.details === undefined &&
      input.type === undefined &&
      input.isDefault === undefined
    ) {
      throw new BadRequestException('At least one address field is required');
    }
  }
}
