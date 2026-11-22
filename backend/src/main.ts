import 'dotenv/config';
import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser = require('cookie-parser');
import { json } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
  app.setGlobalPrefix('api');
  app.enableCors({ origin: frontendOrigin, credentials: true });
  app.use(json({ limit: '16kb' }));
  app.use(cookieParser());
  app.use((request: { method: string; headers: { origin?: string } }, _response: unknown, next: () => void) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== frontendOrigin) {
      throw new ForbiddenException('Invalid origin');
    }
    next();
  });
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
