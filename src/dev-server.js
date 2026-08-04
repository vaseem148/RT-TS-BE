/**
 * `npm run dev:local` — skip MONGO_URI entirely and always use the embedded
 * MongoDB. `npm run dev` reaches the same place automatically when MONGO_URI
 * is unreachable; this entry point just makes the choice explicit.
 */
process.env.USE_LOCAL_DB = 'true';

await import('./server.js');
