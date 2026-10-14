import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtPayload } from './jwt-payload';

/**
 * Gates admin-only routes. Always pair with @UseGuards(JwtAuthGuard, AdminGuard)
 * (in that order) — this guard only checks req.user.isAdmin, it doesn't
 * authenticate on its own. isAdmin is a simple boolean for now (see
 * TASKS.md 1.8 / 2.6) — there's only one kind of admin until a real
 * role/permission model replaces this.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload | undefined;
    if (!user?.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
