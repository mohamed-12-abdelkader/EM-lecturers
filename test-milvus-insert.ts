import { config } from 'dotenv';
config({ path: '.env.development' });
import { MilvusService } from './src/services/milvusService';
import { EmbeddingService } from './src/services/embeddingService';
import { ScientificChatbotService } from './src/services/scientificChatbot';

async function main() {
  try {
    await ScientificChatbotService.initializeCollection();
    const texts = ["Hello world"];
    console.log("Generating embeddings...");
    const embeddings = await EmbeddingService.generateEmbeddings(texts);
    console.log("Got embeddings of dim", embeddings[0].length);
    
    const milvusData = [{
      chunk_text: "Hello world",
      vector: embeddings[0],
      teacher_id: 1,
      course_id: 1,
      file_id: 1,
      chunk_index: 0
    }];
    console.log("Inserting to Milvus...");
    await MilvusService.insertChunks(ScientificChatbotService.COLLECTION_NAME, milvusData);
    console.log("Done");
  } catch (err) {
    console.error("FAILED:", err);
  }
}
main();
