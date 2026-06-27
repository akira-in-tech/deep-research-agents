import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';
import { VoyageAIClient } from 'voyageai';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const COLLECTION_NAME = 'knowledge_base';
const EMBEDDING_DIM = 1024; // voyage-3 outputs 1024-dim vectors

async function main() {
  // 1. Connect to Milvus (running in Docker on port 19530).
  const milvus = new MilvusClient({ address: 'localhost:19530' });
  const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });

  // 2. Drop the collection if it already exists (clean re-ingest).
  const has = await milvus.hasCollection({ collection_name: COLLECTION_NAME });
  if (has.value) {
    await milvus.dropCollection({ collection_name: COLLECTION_NAME });
    console.log('Dropped existing collection.');
  }

  // 3. Create the collection schema: id, the text, and its vector.
  await milvus.createCollection({
    collection_name: COLLECTION_NAME,
    fields: [
      { name: 'id', data_type: DataType.Int64, is_primary_key: true, autoID: true },
      { name: 'doc_id', data_type: DataType.VarChar, max_length: 256 },
      { name: 'text', data_type: DataType.VarChar, max_length: 8192 },
      { name: 'vector', data_type: DataType.FloatVector, dim: EMBEDDING_DIM },
    ],
  });
  console.log('Created collection.');

  // 4. Build an index on the vector field so we can search it.
  await milvus.createIndex({
    collection_name: COLLECTION_NAME,
    field_name: 'vector',
    index_type: 'IVF_FLAT',
    metric_type: 'COSINE',
    params: { nlist: 128 },
  });
  console.log('Created index.');

  // 5. Read all .txt files from the knowledge-base folder.
  const kbDir = path.join(__dirname, '../../knowledge-base');
  const files = fs.readdirSync(kbDir).filter((f) => f.endsWith('.txt'));

  const docIds: string[] = [];
  const texts: string[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(kbDir, file), 'utf-8');
    docIds.push(file);
    texts.push(content);
  }
  console.log(`Read ${texts.length} documents.`);

  // 6. Embed all documents with Voyage.
  const embedResponse = await voyage.embed({
    input: texts,
    model: 'voyage-3',
    inputType: 'document',
  });
  const vectors = embedResponse.data!.map((d) => d.embedding!);
  console.log(`Embedded ${vectors.length} documents.`);

  // 7. Insert everything into Milvus.
  const rows = texts.map((text, i) => ({
    doc_id: docIds[i],
    text: text,
    vector: vectors[i],
  }));
  await milvus.insert({ collection_name: COLLECTION_NAME, data: rows });
  await milvus.flush({ collection_names: [COLLECTION_NAME] });
  console.log(`Inserted ${rows.length} documents into Milvus.`);

  // 8. Load the collection into memory so it's searchable.
  await milvus.loadCollection({ collection_name: COLLECTION_NAME });
  console.log('Collection loaded. Ingestion complete!');

  process.exit(0);
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});