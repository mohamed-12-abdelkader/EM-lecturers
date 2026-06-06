import { config, logger } from '../utils';

export class EmbeddingService {
  // Default dimension - will be updated dynamically based on model response
  static readonly EMBEDDING_DIMENSION = 768; // Common default for embedding models
  private static cachedDimension: number | null = null;

  /**
   * Generate embedding for text using Ollama API
   */
  static async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${config.OLLAMA_API_URL}/api/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.OLLAMA_EMBEDDING_MODEL,
          input: text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as
        | { embedding: number[] }
        | { embeddings: number[][] }
        | number[];

      let embedding: number[];

      // Handle different response formats
      if (Array.isArray(data)) {
        // Direct array response
        embedding = data;
      } else if ('embedding' in data && Array.isArray(data.embedding)) {
        // Object with embedding property
        embedding = data.embedding;
      } else if (
        'embeddings' in data &&
        Array.isArray(data.embeddings) &&
        data.embeddings.length > 0
      ) {
        // Batch response for single input (take first)
        embedding = data.embeddings[0];
      } else {
        throw new Error('Invalid embedding response from Ollama API');
      }

      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('Empty embedding values returned from Ollama API');
      }

      // Cache the actual dimension from the API response
      if (this.cachedDimension === null) {
        this.cachedDimension = embedding.length;
        logger.info(
          `Ollama embedding dimension detected: ${this.cachedDimension} (model: ${config.OLLAMA_EMBEDDING_MODEL})`,
        );
      }

      return embedding;
    } catch (error) {
      logger.error('Error generating embedding with Ollama API:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts using Ollama API
   */
  static async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    try {
      const response = await fetch(`${config.OLLAMA_API_URL}/api/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.OLLAMA_EMBEDDING_MODEL,
          input: texts, // Ollama supports batch input as array
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as
        | { embeddings: number[][] }
        | { embedding: number[] }
        | number[][]
        | number[];

      // Ollama returns embeddings as an array when input is an array
      let embeddings: number[][];
      if (Array.isArray(data)) {
        if (data.length > 0 && Array.isArray(data[0])) {
          // Direct array of arrays
          embeddings = data as number[][];
        } else {
          // Single array (shouldn't happen for batch, but handle it)
          embeddings = [data as number[]];
        }
      } else if ('embeddings' in data && Array.isArray(data.embeddings)) {
        embeddings = data.embeddings;
      } else if ('embedding' in data && Array.isArray(data.embedding)) {
        // Single embedding returned for batch (shouldn't happen, but handle it)
        embeddings = [data.embedding];
      } else {
        throw new Error('Invalid embeddings response format from Ollama API');
      }

      if (embeddings.length !== texts.length) {
        throw new Error(`Expected ${texts.length} embeddings, but received ${embeddings.length}`);
      }

      // Validate and cache dimension
      for (const embedding of embeddings) {
        if (!Array.isArray(embedding) || embedding.length === 0) {
          throw new Error('Empty or invalid embedding values returned from Ollama API');
        }
      }

      // Cache the actual dimension from the API response (use first embedding)
      if (this.cachedDimension === null && embeddings.length > 0) {
        this.cachedDimension = embeddings[0].length;
        logger.info(
          `Ollama embedding dimension detected: ${this.cachedDimension} (model: ${config.OLLAMA_EMBEDDING_MODEL})`,
        );
      }

      return embeddings;
    } catch (error) {
      logger.error('Error generating embeddings with Ollama API:', error);
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
