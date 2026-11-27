import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { WishlistService } from './wishlist.service';

@Controller('wishlist')
@Roles(UserRole.USER)
export class WishlistController {
  constructor(private readonly wishlistService: WishlistService) {}

  @Get()
  findMine(@CurrentUser() user: AuthUser) {
    return this.wishlistService.findMine(user.id);
  }

  @Post(':bookId')
  add(@CurrentUser() user: AuthUser, @Param('bookId') bookId: string) {
    return this.wishlistService.add(user.id, bookId);
  }

  @Delete(':bookId')
  remove(@CurrentUser() user: AuthUser, @Param('bookId') bookId: string) {
    return this.wishlistService.remove(user.id, bookId);
  }
}
