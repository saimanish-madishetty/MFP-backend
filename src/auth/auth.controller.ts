import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import {
  AdminOnly,
  AnyRole,
  CurrentUser,
  Public,
  type AuthUser,
} from './decorators.js';
import {
  ChangePinDto,
  CreateUserDto,
  LoginDto,
  UpdateUserDto,
} from './dto/auth.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /** Who is logged in (the app checks this on start). */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @AnyRole()
  @Post('pin')
  @HttpCode(200)
  changePin(@CurrentUser() user: AuthUser, @Body() dto: ChangePinDto) {
    return this.auth.changePin(user, dto);
  }
}

@AdminOnly()
@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  list() {
    return this.auth.listUsers();
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.auth.createUser(dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ) {
    return this.auth.updateUser(me, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() me: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.auth.deleteUser(me, id);
  }
}
