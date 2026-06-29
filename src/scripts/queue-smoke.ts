import { Queue, QueueEvents, Worker } from 'bullmq';

interface SmokeJobData {
  value: string;
}

async function main(): Promise<void> {
  const queueName = `deep-research-smoke-${process.pid}`;
  const connection = {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    maxRetriesPerRequest: null,
  };
  const queue = new Queue<SmokeJobData, string>(queueName, { connection });
  const events = new QueueEvents(queueName, { connection });
  const worker = new Worker<SmokeJobData, string>(
    queueName,
    (job) => Promise.resolve(job.data.value),
    { connection },
  );

  try {
    await Promise.all([
      queue.waitUntilReady(),
      events.waitUntilReady(),
      worker.waitUntilReady(),
    ]);
    const job = await queue.add(
      'smoke',
      { value: 'queue-ok' },
      { removeOnComplete: true, removeOnFail: true },
    );
    const result = await job.waitUntilFinished(events, 10_000);
    if (result !== 'queue-ok') {
      throw new Error(`Unexpected BullMQ result: ${String(result)}`);
    }
    console.log('BullMQ queue smoke test passed.');
  } finally {
    await worker.close();
    await events.close();
    await queue.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
