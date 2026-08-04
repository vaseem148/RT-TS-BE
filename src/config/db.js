import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('strictQuery', true);

/**
 * Connects to MongoDB. Throws on failure so the caller can decide what to do
 * — the dev server falls back to an embedded instance, production exits.
 */
export async function connectDB(uri = env.mongoUri, { timeoutMs = 5000 } = {}) {
  const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: timeoutMs });
  console.log(`✅  MongoDB connected → ${conn.connection.host}/${conn.connection.name}`);
  return conn;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}

export const isConnected = () => mongoose.connection.readyState === 1;
