import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true keeps the exact, unparsed request bytes available as
  // `req.rawBody` on every request (alongside the normally-parsed
  // `req.body`) — needed by the Razorpay webhook handler, whose HMAC
  // signature is computed over the raw payload, not the re-serialized JSON.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
  });

  // Strips unknown fields and rejects requests that don't match the DTO
  // shape — every controller in this project relies on this rather than
  // re-validating manually.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');

  // Not exposed in production by default — this is a docs/dev-ergonomics
  // tool, and an unauthenticated public API surface map is worth gating
  // the same way the admin/debug-leaning defaults in Phase 0 were.
  if ((process.env.NODE_ENV ?? 'development') !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('MeraFarm API')
      .setDescription('Campaigns, price-ladder pricing, orders, auth, referrals')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT ?? 4001;
  await app.listen(port);
  console.log(`MeraFarm API listening on http://localhost:${port}/api`);
}
bootstrap();
