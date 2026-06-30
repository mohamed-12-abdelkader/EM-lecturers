"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddingService = void 0;
const utils_1 = require("../utils");
class EmbeddingService {
    static EMBEDDING_DIMENSION = utils_1.config.OPENAI_EMBEDDING_DIMENSIONS;
    static cachedDimension = null;
    /**
     * Generate embedding for text using OpenAI embeddings API
     */
    static async generateEmbedding(text) {
        const [embedding] = await this.generateEmbeddings([text]);
        return embedding;
    }
    /**
     * Generate embeddings for multiple texts using OpenAI embeddings API
     */
    static async generateEmbeddings(texts) {
        if (texts.length === 0) {
            return [];
        }
        try {
            const apiKey = utils_1.config.OPENAI_API_KEY.trim();
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
                    model: utils_1.config.OPENAI_EMBEDDING_MODEL,
                    input: texts,
                    dimensions: utils_1.config.OPENAI_EMBEDDING_DIMENSIONS,
                }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenAI Embedding API error: ${response.status} - ${errorText}`);
            }
            const data = (await response.json());
            const embeddings = data.data?.map((item) => item.embedding);
            if (!embeddings || embeddings.length !== texts.length) {
                throw new Error(`Expected ${texts.length} embeddings, but received ${embeddings?.length ?? 0}`);
            }
            const validatedEmbeddings = [];
            for (const embedding of embeddings) {
                if (!Array.isArray(embedding) || embedding.length === 0) {
                    throw new Error('Empty or invalid embedding values returned from OpenAI API');
                }
                validatedEmbeddings.push(embedding);
            }
            if (this.cachedDimension === null && validatedEmbeddings.length > 0) {
                this.cachedDimension = validatedEmbeddings[0].length;
                utils_1.logger.info(`OpenAI embedding dimension detected: ${this.cachedDimension} (model: ${utils_1.config.OPENAI_EMBEDDING_MODEL})`);
            }
            return validatedEmbeddings;
        }
        catch (error) {
            utils_1.logger.error('Error generating embeddings with OpenAI API:', error);
            throw error;
        }
    }
    /**
     * Get embedding dimension
     * Returns the cached dimension from API if available, otherwise returns the default
     */
    static getDimension() {
        return this.cachedDimension ?? this.EMBEDDING_DIMENSION;
    }
}
exports.EmbeddingService = EmbeddingService;
