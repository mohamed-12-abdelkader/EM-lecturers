import { config, logger } from '../utils';

type OpenAIEmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
  }>;
};

export class EmbeddingService {
  static readonly EMBEDDING_DIMENSION = config.OPENAI_EMBEDDING_DIMENSIONS;
  private static cachedDimension: number | null = null;

  /**
   * Generate embedding for text using OpenAI embeddings API
   */
  static async generateEmbedding(text: string): Promise<number[]> {
    const [embedding] = await this.generateEmbeddings([text]);
    return embedding;
  }

  /**
   * Generate embeddings for multiple texts using OpenAI embeddings API
   */
  static async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    try {
      const apiKey = config.OPENAI_API_KEY.trim();
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required for embeddings');
      }

      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.OPENAI_EMBEDDING_MODEL,
          input: texts,
          dimensions: config.OPENAI_EMBEDDING_DIMENSIONS,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI Embedding API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as OpenAIEmbeddingResponse;
      const embeddings = data.data?.map((item) => item.embedding);

      if (!embeddings || embeddings.length !== texts.length) {
        throw new Error(
          `Expected ${texts.length} embeddings, but received ${embeddings?.length ?? 0}`,
        );
      }

      const validatedEmbeddings: number[][] = [];
      for (const embedding of embeddings) {
        if (!Array.isArray(embedding) || embedding.length === 0) {
          throw new Error('Empty or invalid embedding values returned from OpenAI API');
        }
        validatedEmbeddings.push(embedding);
      }

      if (this.cachedDimension === null && validatedEmbeddings.length > 0) {
        this.cachedDimension = validatedEmbeddings[0].length;
        logger.info(
          `OpenAI embedding dimension detected: ${this.cachedDimension} (model: ${config.OPENAI_EMBEDDING_MODEL})`,
        );
      }

      return validatedEmbeddings;
    } catch (error) {
      logger.error('Error generating embeddings with OpenAI API:', error);
      throw error;
    }
  }

  /**
   * Get embedding dimension
   * Returns the cached dimension from API if available, otherwise returns the default
   */
  static getDimension(): number {
    return this.cachedDimension ?? this.EMBEDDING_DIMENSION;
  }
}
