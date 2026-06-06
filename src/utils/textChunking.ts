/**
 * Splits text into chunks for RAG, based on a target token count and overlap percentage.
 * - Splits by paragraph first.
 * - Respects word boundaries (doesn't split in the middle of a word).
 * - Overlaps a configurable percentage of tokens between consecutive chunks.
 * - Token estimation: 1 token ≈ 4 characters.
 */
export function chunkText(
  text: string,
  targetTokens: number,
  overlapPercent: number = 0.15,
): string[] {
  if (!text) return [];

  const estimateTokens = (str: string) => Math.ceil(str.length / 4);

  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];

  let currentChunk: string[] = [];
  let currentTokens = 0;

  let i = 0;

  while (i < paragraphs.length) {
    const paragraph = paragraphs[i];
    const paragraphTokens = estimateTokens(paragraph);

    // 🔹 Large paragraph → split by words
    if (paragraphTokens > targetTokens) {
      const words = paragraph.split(/\s+/);
      let tempChunkWords: string[] = [];
      let tempTokens = 0;

      for (const word of words) {
        const wordTokens = estimateTokens(word);

        if (tempTokens + wordTokens > targetTokens) {
          if (tempChunkWords.length) {
            chunks.push(tempChunkWords.join(' '));
          }

          const overlapCount = Math.floor(tempChunkWords.length * overlapPercent);

          if (overlapCount > 0) {
            tempChunkWords = tempChunkWords.slice(-overlapCount);
            tempTokens = estimateTokens(tempChunkWords.join(' '));
          } else {
            tempChunkWords = [];
            tempTokens = 0;
          }
        }

        tempChunkWords.push(word);
        tempTokens += wordTokens;
      }

      if (tempChunkWords.length) {
        chunks.push(tempChunkWords.join(' '));
      }

      i++;
      continue;
    }

    // 🔹 Normal paragraph handling
    if (currentTokens + paragraphTokens <= targetTokens) {
      currentChunk.push(paragraph);
      currentTokens += paragraphTokens;
      i++;
    } else {
      chunks.push(currentChunk.join('\n\n'));

      const overlapTokens = Math.floor(currentTokens * overlapPercent);
      let overlapChunk: string[] = [];
      let accumulatedTokens = 0;

      if (overlapTokens > 0) {
        for (let j = currentChunk.length - 1; j >= 0; j--) {
          const p = currentChunk[j];
          const pTokens = estimateTokens(p);
          if (accumulatedTokens + pTokens > overlapTokens) break;
          overlapChunk.unshift(p);
          accumulatedTokens += pTokens;
        }
      }

      currentChunk = overlapChunk;
      currentTokens = accumulatedTokens;
    }
  }

  if (currentChunk.length) {
    chunks.push(currentChunk.join('\n\n'));
  }

  return chunks;
}

