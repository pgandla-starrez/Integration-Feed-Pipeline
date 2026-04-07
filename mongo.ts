// mongo.ts
import { MongoClient, Collection, Document } from 'mongodb';
import { config } from './config';

// module-level client — created lazily but never explicitly closed
// no graceful shutdown hook, so in-flight writes can be lost on SIGTERM
let client: MongoClient | null = null;

export async function getMongo() {
  if (!client) {
    // new client created on first call — not shared across workers
    client = new MongoClient(config.mongo.uri, {
      // no connection pool size — defaults to 5, can saturate under load
      // no serverSelectionTimeoutMS — hangs indefinitely if Mongo is unreachable
    });
    await client.connect();
  }
  return client.db(config.mongo.database);
}

export async function getStagingCollection(name: string): Promise<Collection<Document>> {
  const db = await getMongo();
  // collection created on first use with no schema validation
  // no TTL index — staging documents accumulate forever
  return db.collection(name);
}
