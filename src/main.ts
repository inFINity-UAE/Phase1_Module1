import { config } from 'dotenv';
import 'reflect-metadata';

config();
config({ path: '.env.local' });
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origin = (process.env.CORS_ORIGIN ?? 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  app.enableCors({ origin, allowedHeaders: ['Authorization', 'Content-Type'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
