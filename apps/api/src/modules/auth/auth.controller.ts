import {
  Body,
  Controller,
  Get,
  Ip,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './auth.constants';
import { AuthService, RequestMeta, TokenPair } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private buildMeta(req: Request, ip?: string): RequestMeta {
    return {
      ipAddress: ip,
      userAgent: req.headers['user-agent'],
    };
  }

  private setAuthCookies(res: Response, tokens: TokenPair): void {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
    });
    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterCustomerDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
  ) {
    const tokens = await this.authService.registerCustomer(
      dto,
      this.buildMeta(req, ip),
    );
    this.setAuthCookies(res, tokens);
    return tokens;
  }

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
  ) {
    const tokens = await this.authService.login(dto, this.buildMeta(req, ip));
    this.setAuthCookies(res, tokens);
    return tokens;
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
  ) {
    const cookieToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as
      string | undefined;
    const refreshToken = dto.refreshToken ?? cookieToken;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }
    const tokens = await this.authService.refresh(
      refreshToken,
      this.buildMeta(req, ip),
    );
    this.setAuthCookies(res, tokens);
    return tokens;
  }

  @Public()
  @Post('logout')
  async logout(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as
      string | undefined;
    const refreshToken = dto.refreshToken ?? cookieToken;
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    res.clearCookie(ACCESS_TOKEN_COOKIE);
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/api/v1/auth' });
    return { loggedOut: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthContext) {
    return this.authService.getMe(user.sub);
  }

  @Patch('change-password')
  async changePassword(
    @CurrentUser() user: AuthContext,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(user.sub, dto);
    return { changed: true };
  }
}
