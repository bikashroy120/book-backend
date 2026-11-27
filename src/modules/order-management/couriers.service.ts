import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { CreateCourierDTO, UpdateCourierDTO } from './dto/courier.dto';

@Injectable()
export class CouriersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.courier.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, phone: true, isActive: true },
    });
  }

  async create(input: CreateCourierDTO) {
    try {
      return await this.prisma.courier.create({
        data: {
          name: input.name.trim(),
          phone: input.phone,
          isActive: input.isActive ?? true,
        },
        select: { id: true, name: true, phone: true, isActive: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A courier with this name already exists');
      }
      throw error;
    }
  }

  async update(courierId: string, input: UpdateCourierDTO) {
    const existing = await this.prisma.courier.findUnique({
      where: { id: courierId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Courier not found');
    try {
      return await this.prisma.courier.update({
        where: { id: courierId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        select: { id: true, name: true, phone: true, isActive: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A courier with this name already exists');
      }
      throw error;
    }
  }

  async deactivate(courierId: string) {
    const result = await this.prisma.courier.updateMany({
      where: { id: courierId },
      data: { isActive: false },
    });
    if (result.count !== 1) throw new NotFoundException('Courier not found');
    return this.prisma.courier.findUniqueOrThrow({
      where: { id: courierId },
      select: { id: true, name: true, phone: true, isActive: true },
    });
  }
}
