/* eslint-disable @typescript-eslint/unbound-method */
import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { LongTermMemory } from './entities/long-term-memory.entity';
import { LongTermMemoryService } from './long-term-memory.service';

describe('LongTermMemoryService', () => {
  let repository: jest.Mocked<Repository<LongTermMemory>>;
  let service: LongTermMemoryService;

  beforeEach(() => {
    repository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
    } as unknown as jest.Mocked<Repository<LongTermMemory>>;
    service = new LongTermMemoryService(repository);
  });

  it('stores a normalized user fact', async () => {
    const memory = {
      id: 'memory-1',
      userId: 'user-1',
      fact: 'Prefers concise reports',
    } as LongTermMemory;
    repository.findOne.mockResolvedValue(null);
    repository.create.mockReturnValue(memory);
    repository.save.mockResolvedValue(memory);

    const result = await service.remember(
      ' user-1 ',
      ' Prefers concise reports ',
    );

    expect(result).toBe(memory);
    expect(repository.create).toHaveBeenCalledWith({
      userId: 'user-1',
      fact: 'Prefers concise reports',
    });
  });

  it('does not duplicate an existing fact', async () => {
    const existing = {
      id: 'memory-1',
      userId: 'user-1',
      fact: 'Prefers concise reports',
    } as LongTermMemory;
    repository.findOne.mockResolvedValue(existing);

    await expect(
      service.remember('user-1', 'Prefers concise reports'),
    ).resolves.toBe(existing);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects an empty fact', async () => {
    await expect(service.remember('user-1', '   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
