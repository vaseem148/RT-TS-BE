import app from './app.js';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { startLocalMongo } from './config/local-mongo.js';

/** Set by `npm run dev:local` to skip straight to the embedded database. */
const forceLocal = process.env.USE_LOCAL_DB === 'true';

let localMongo = null;

/**
 * Connects to MONGO_URI, and in development falls back to an embedded
 * MongoDB when that is unreachable — so the API starts even on a machine
 * with no MongoDB installed.
 */
async function connectWithFallback() {
  if (!forceLocal) {
    try {
      await connectDB();
      return 'configured';
    } catch (error) {
      if (env.isProd) {
        console.error('❌  MongoDB connection failed:', error.message);
        console.error('    Check MONGO_URI — refusing to start with a temporary database.');
        process.exit(1);
      }
      console.warn(`\n⚠️   Could not reach ${env.mongoUri}`);
      console.warn('    (' + error.message + ')');
      console.warn('    Falling back to an embedded MongoDB for local development.\n');
    }
  }

  console.log('⏳  Starting embedded MongoDB (first run downloads the engine, ~1 min)...');
  localMongo = await startLocalMongo();
  await connectDB(localMongo.uri, { timeoutMs: 20000 });
  return 'embedded';
}

/** Populates the demo catalogue the first time an empty database is used. */
async function seedIfEmpty() {
  const { User } = await import('./models/User.js');
  if ((await User.countDocuments()) > 0) return;

  console.log('🌱  Empty database detected — seeding demo data...');
  const { seedDatabase } = await import('./seed/seed.js');
  await seedDatabase({ keepConnection: true });
}

const start = async () => {
  const mode = await connectWithFallback();

  if (mode === 'embedded') await seedIfEmpty();

  const dbLabel =
    mode !== 'embedded'
      ? env.mongoUri
      : localMongo?.persisted
        ? 'embedded MongoDB (./.mongo-data)'
        : 'embedded MongoDB (temporary — not persisted)';

  const server = app.listen(env.port, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║   RENDERWAYS TECHNOLOGY · API                    ║
╠══════════════════════════════════════════════════╣
║   Mode      ${env.nodeEnv.padEnd(37)}║
║   API       http://localhost:${String(env.port).padEnd(20)}║
║   Client    ${env.clientUrl.padEnd(37)}║
╚══════════════════════════════════════════════════╝

  Database   ${dbLabel}
${
  mode === 'embedded'
    ? `
  Sign in with:
    admin@renderways.in   / admin123    (admin)
    bala@renderways.in    / tech123     (technician)
    sumaiya@example.com   / demo123     (customer)
`
    : ''
}`);
  });

  const shutdown = (signal) => async () => {
    console.log(`\n${signal} received — shutting down gracefully...`);
    server.close();
    if (localMongo) await localMongo.stop().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', shutdown('SIGINT'));
  process.on('SIGTERM', shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    console.error('🔥 Unhandled rejection:', reason);
    server.close(() => process.exit(1));
  });
};

start().catch((error) => {
  console.error('❌  Failed to start the API:', error);
  process.exit(1);
});
