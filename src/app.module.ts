import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [DbModule, HealthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
