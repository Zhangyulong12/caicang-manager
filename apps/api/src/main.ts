import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { apiPort, webOrigins } from './config/env.js';

const app = await NestFactory.create(AppModule);
app.setGlobalPrefix('api/v1');
app.enableCors({ origin: webOrigins(), methods: ['GET'] });
app.enableShutdownHooks();
const config = new DocumentBuilder().setTitle('采仓管家 API').setVersion('0.1.0').build();
SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
await app.listen(apiPort(), '0.0.0.0');
