import { Controller, Get } from '@nestjs/common';
import { RoomService } from './room.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly rooms: RoomService) {}

  @Get()
  health() {
    return { ok: true, rooms: this.rooms.size };
  }
}
