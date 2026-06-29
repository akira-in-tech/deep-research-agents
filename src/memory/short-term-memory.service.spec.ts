/* eslint-disable @typescript-eslint/unbound-method */
import { Repository } from 'typeorm';
import { ShortTermMemory } from './entities/short-term-memory.entity';
import { ShortTermMemoryService } from './short-term-memory.service';

describe('ShortTermMemoryService', () => {
  let repository: jest.Mocked<Repository<ShortTermMemory>>;
  let service: ShortTermMemoryService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
    } as unknown as jest.Mocked<Repository<ShortTermMemory>>;
    service = new ShortTermMemoryService(repository);
  });

  it('saves a research turn', async () => {
    const entry = {
      sessionId: 'session-1',
      question: 'Question',
      report: 'Answer',
    } as ShortTermMemory;
    repository.create.mockReturnValue(entry);
    repository.save.mockResolvedValue(entry);

    await service.saveContext('session-1', 'Question', 'Answer');

    expect(repository.create).toHaveBeenCalledWith({
      sessionId: 'session-1',
      question: 'Question',
      report: 'Answer',
    });
    expect(repository.save).toHaveBeenCalledWith(entry);
  });

  it('returns recent turns in chronological order', async () => {
    repository.find.mockResolvedValue([
      {
        question: 'Second question',
        report: 'Second answer',
      } as ShortTermMemory,
      {
        question: 'First question',
        report: 'First answer',
      } as ShortTermMemory,
    ]);

    const context = await service.getContext('session-1');

    expect(repository.find).toHaveBeenCalledWith({
      where: { sessionId: 'session-1' },
      order: { createdAt: 'DESC' },
      take: 5,
    });
    expect(context.indexOf('First question')).toBeLessThan(
      context.indexOf('Second question'),
    );
    expect(context).toContain('First answer');
    expect(context).toContain('Second answer');
  });
});
