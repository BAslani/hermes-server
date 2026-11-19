import { Module } from '@nestjs/common';
import { CoopGateway } from './coop.gateway.js';
import { HealthController } from './health.controller.js';
import { RoomService } from './room.service.js';

@Module({
  controllers: [HealthController],
  providers: [RoomService, CoopGateway],
})
export class AppModule {}
