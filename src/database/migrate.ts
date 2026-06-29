import dataSource from './data-source';

type MigrationAction = 'run' | 'show' | 'revert';

async function main(): Promise<void> {
  const action = process.argv[2] as MigrationAction | undefined;
  if (!action || !['run', 'show', 'revert'].includes(action)) {
    throw new Error('Usage: ts-node src/database/migrate.ts run|show|revert');
  }

  await dataSource.initialize();
  try {
    if (action === 'show') {
      const pending = await dataSource.showMigrations();
      console.log(`Pending migrations: ${pending ? 'yes' : 'no'}`);
      return;
    }

    if (action === 'revert') {
      await dataSource.undoLastMigration({ transaction: 'all' });
      console.log('Reverted the latest migration.');
      return;
    }

    const applied = await dataSource.runMigrations({ transaction: 'all' });
    if (applied.length === 0) {
      console.log('No pending migrations.');
      return;
    }
    console.log(
      `Applied migrations: ${applied.map(({ name }) => name).join(', ')}`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
