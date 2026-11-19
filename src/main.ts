import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';
import { configureApp } from './setup.js';

async function bootstrap() {
  const config = loadConfig();
  const app = configureApp(await NestFactory.create(AppModule), config);
  await app.listen(config.port);
}
await bootstrap();
