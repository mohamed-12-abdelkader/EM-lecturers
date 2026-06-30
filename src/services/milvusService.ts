import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';
import { config, logger } from '../utils';

export interface MilvusCollectionConfig {
  collectionName: string;
  dimension: number;
  metricType?: 'IP' | 'L2';
  consistencyLevel?: 'Strong' | 'Session' | 'Bounded' | 'Eventually';
}

export class MilvusService {
  private static client: MilvusClient | null = null;
  private static readonly DEFAULT_DIMENSION = 1024; // DeepSeek embedding dimension
  private static readonly DEFAULT_METRIC = 'IP' as const;
  private static readonly DEFAULT_CONSISTENCY = 'Bounded' as const;

  /**
   * Get or create Milvus client instance
   */
  static async getClient(): Promise<MilvusClient> {
    if (!this.client) {
      const address = config.MILVUS_ADDRESS;
      const username = config.MILVUS_USERNAME;
      const password = config.MILVUS_PASSWORD;

      this.client = new MilvusClient({
        address,
        username,
        password,
      });

      await this.client.connectPromise;
      logger.info('✅ Connected to Milvus');
    }
    return this.client;
  }

  /**
   * Create a database if it doesn't exist
   */
  static async createDatabase(dbName: string): Promise<void> {
    const client = await this.getClient();

    try {
      const databases = await client.listDatabases();
      if (!databases.db_names.includes(dbName)) {
        await client.createDatabase({ db_name: dbName });
        logger.info(`✅ Created database: ${dbName}`);
      }
    } catch (error: any) {
      logger.error(`Error creating database ${dbName}:`, error.message);
      throw error;
    }
  }

  /**
   * Create a collection for course content
   */
  static async createCollection(config: MilvusCollectionConfig): Promise<void> {
    const client = await this.getClient();
    const { collectionName, dimension, metricType = this.DEFAULT_METRIC } = config;

    try {
      // Check if collection exists

      const exists = await client.hasCollection({
        collection_name: collectionName,
      });

      if (exists.value) {
        logger.info(`Collection ${collectionName} already exists`);
        return;
      }

      // Define schema
      const schema = [
        {
          name: 'id',
          description: 'Chunk ID',
          data_type: DataType.Int64,
          is_primary_key: true,
          autoID: true,
        },
        {
          name: 'chunk_text',
          description: 'Text content of the chunk',
          data_type: DataType.VarChar,
          max_length: 10000,
        },
        {
          name: 'vector',
          description: 'Embedding vector',
          data_type: DataType.FloatVector,
          dim: dimension,
        },
        {
          name: 'teacher_id',
          description: 'Teacher ID',
          data_type: DataType.Int64,
        },
        {
          name: 'course_id',
          description: 'Course ID',
          data_type: DataType.Int64,
        },
        {
          name: 'file_id',
          description: 'File ID from SQL DB',
          data_type: DataType.Int64,
        },
        {
          name: 'chunk_index',
          description: 'Index of chunk in the file',
          data_type: DataType.Int64,
        },
      ];

      // Create collection
      await client.createCollection({
        collection_name: collectionName,
        fields: schema,
      });

      logger.info(`✅ Created collection: ${collectionName}`);

      // Create index on vector field
      await client.createIndex({
        collection_name: collectionName,
        field_name: 'vector',
        index_name: 'vector_index',
        index_type: 'HNSW',
        params: { efConstruction: 200, M: 16 },
        metric_type: metricType,
      });

      logger.info(`✅ Created index for collection: ${collectionName}`);

      // Load collection
      await client.loadCollectionSync({
        collection_name: collectionName,
      });

      logger.info(`✅ Loaded collection: ${collectionName}`);
    } catch (error: any) {
      logger.error(`Error creating collection ${collectionName}:`, error.message);
      throw error;
    }
  }

  /**
   * Insert chunks into collection
   */
  static async insertChunks(
    collectionName: string,
    chunks: Array<{
      chunk_text: string;
      vector: number[];
      teacher_id: number;
      course_id: number;
      file_id: number;
      chunk_index: number;
    }>,
  ): Promise<void> {
    const client = await this.getClient();

    console.log('example vector chunk', chunks[0].vector);

    try {
      // the num_rows (32) of field (vector) is not equal to passed num_rows (8)
      const result = await client.insert({
        collection_name: collectionName,
        data: chunks,
      });
      
      console.log('result', result);

      logger.info(`✅ Inserted ${chunks.length} chunks into ${collectionName}`);
    } catch (error: any) {
      logger.error(`Error inserting chunks:`, error);
      throw error;
    }
  }

  /**
   * Search for similar chunks
   */
  static async searchSimilarChunks(
    collectionName: string,
    queryVector: number[],
    teacherId: number,
    courseId: number,
    limit: number = 3,
  ): Promise<
    Array<{
      score: number;
      chunk_text: string;
      teacher_id: number;
      course_id: number;
      file_id: number;
      chunk_index: number;
    }>
  > {
    const client = await this.getClient();

    try {
      const results = await client.search({
        collection_name: collectionName,
        data: [queryVector],
        limit,
        filter: `teacher_id == ${teacherId} && (course_id == ${courseId} || course_id == 0)`,
        output_fields: ['chunk_text', 'teacher_id', 'course_id', 'file_id', 'chunk_index'],
        params: { ef: 64 },
      });

      if (!results.results || results.status.error_code !== 'Success' || results.results.length === 0) {
        return [];
      }

      return results.results.map((result: any) => ({
        score: result.score,
        chunk_text: result.chunk_text,
        teacher_id: result.teacher_id,
        course_id: result.course_id,
        file_id: result.file_id,
        chunk_index: result.chunk_index,
      }));
    } catch (error: any) {
      logger.error(`Error searching chunks:`, error.message);
      throw error;
    }
  }

  /**
   * Delete chunks by course_id and teacher_id
   */
  static async deleteCourseChunks(
    collectionName: string,
    teacherId: number,
    courseId: number,
  ): Promise<void> {
    const client = await this.getClient();

    try {
      // Milvus delete requires primary keys, so we need to query first
      const searchResults = await client.query({
        collection_name: collectionName,
        filter: `teacher_id == ${teacherId} && course_id == ${courseId}`,
        output_fields: ['id'],
      });

      if (searchResults.data && searchResults.data.length > 0) {
        const ids = searchResults.data.map((item: any) => item.id);

        await client.delete({
          collection_name: collectionName,
          ids: ids,
        });

        logger.info(`✅ Deleted ${ids.length} chunks for course ${courseId}`);
      }
    } catch (error: any) {
      logger.error(`Error deleting chunks:`, error.message);
      throw error;
    }
  }

  /**
   * Search for similar chunks by teacher across all their content
   */
  static async searchSimilarChunksByTeacher(
    collectionName: string,
    queryVector: number[],
    teacherId: number,
    limit: number = 3,
  ): Promise<
    Array<{
      score: number;
      chunk_text: string;
      teacher_id: number;
      course_id: number;
      file_id: number;
      chunk_index: number;
    }>
  > {
    const client = await this.getClient();

    try {
      const results = await client.search({
        collection_name: collectionName,
        data: [queryVector],
        limit,
        filter: `teacher_id == ${teacherId}`,
        output_fields: ['chunk_text', 'teacher_id', 'course_id', 'file_id', 'chunk_index'],
        params: { ef: 64 },
      });

      console.log('results', results);

      if (!results.results || results.status.error_code !== "Success" || results.results.length === 0) {
        return [];
      }

      return results.results.map((result: any) => ({
        score: result.score,
        chunk_text: result.chunk_text,
        teacher_id: result.teacher_id,
        course_id: result.course_id,
        file_id: result.file_id,
        chunk_index: result.chunk_index,
      }));
    } catch (error: any) {
      logger.error(`Error searching chunks by teacher:`, error.message);
      throw error;
    }
  }

  /**
   * Delete all chunks for a specific teacher
   */
  static async deleteTeacherChunks(
    collectionName: string,
    teacherId: number,
  ): Promise<void> {
    const client = await this.getClient();

    try {
      const searchResults = await client.query({
        collection_name: collectionName,
        filter: `teacher_id == ${teacherId}`,
        output_fields: ['id'],
      });

      if (searchResults.data && searchResults.data.length > 0) {
        const ids = searchResults.data.map((item: any) => item.id);

        await client.delete({
          collection_name: collectionName,
          ids: ids,
        });

        logger.info(`✅ Deleted ${ids.length} chunks for teacher ${teacherId}`);
      }
    } catch (error: any) {
      logger.error(`Error deleting teacher chunks:`, error.message);
      throw error;
    }
  }

  /**
   * Delete chunks for a specific file
   */
  static async deleteFileChunks(
    collectionName: string,
    teacherId: number,
    fileId: number,
  ): Promise<void> {
    const client = await this.getClient();

    try {
      const searchResults = await client.query({
        collection_name: collectionName,
        filter: `teacher_id == ${teacherId} && file_id == ${fileId}`,
        output_fields: ['id'],
      });

      if (searchResults.data && searchResults.data.length > 0) {
        const ids = searchResults.data.map((item: any) => item.id);

        await client.delete({
          collection_name: collectionName,
          ids: ids,
        });

        logger.info(`✅ Deleted ${ids.length} chunks for file ${fileId}`);
      }
    } catch (error: any) {
      logger.error(`Error deleting file chunks:`, error.message);
      throw error;
    }
  }

  /**
   * Check if collection exists
   */
  static async collectionExists(collectionName: string): Promise<boolean> {
    try {
      const client = await this.getClient();
      const collections = await client.listCollections();
      const collectionNames = (collections as any).collection_names || [];
      return collectionNames.includes(collectionName);
    } catch (_error) {
      return false;
    }
  }
}
