import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { durationToSeconds } from '../../common/utils/duration.util';
import { AuditModule } from '../audit/audit.module';
import { CompanyModule } from '../company/company.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { TwoFactorService } from './two-factor.service';

@Module({
  imports: [
    PassportModule,
    RbacModule,
    AuditModule,
    CompanyModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: durationToSeconds(
            configService.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
          ),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAccessStrategy,
    TwoFactorService,
    SessionsService,
  ],
  exports: [AuthService, TwoFactorService, SessionsService],
})
export class AuthModule {}
