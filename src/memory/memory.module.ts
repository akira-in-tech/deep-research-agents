import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LongTermMemory } from './entities/long-term-memory.entity';
import { ShortTermMemory } from './entities/short-term-memory.entity';
import { ShortTermMemoryService } from './short-term-memory.service';
import { LongTermMemoryService } from './long-term-memory.service';
import { MemoryManagerService } from './memory-manager.service';
import { MemoryResolver } from './memory.resolver';
import { SemanticMemoryService } from './semantic-memory.service';

@Module({
  imports: [TypeOrmModule.forFeature([ShortTermMemory, LongTermMemory])],
  providers: [
    ShortTermMemoryService,
    LongTermMemoryService,
    MemoryManagerService,
    SemanticMemoryService,
    MemoryResolver,
  ],
  exports: [
    ShortTermMemoryService,
    LongTermMemoryService,
    MemoryManagerService,
    SemanticMemoryService,
  ],
})
export class MemoryModule {}
