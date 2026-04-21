/**
 * Given chunks array and a global timestamp (seconds),
 * returns which chunk contains that timestamp and the seek offset within it.
 */
export function findChunkForTimestamp(chunks, timestamp) {
  if (!chunks || chunks.length === 0) {
    return { chunkIdx: 0, offsetWithinChunk: 0 };
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (timestamp >= chunk.startTime && timestamp < chunk.endTime) {
      return {
        chunkIdx: i,
        offsetWithinChunk: timestamp - chunk.startTime,
      };
    }
  }

  // timestamp is at or past the end — use last chunk's end
  const last = chunks[chunks.length - 1];
  return {
    chunkIdx: chunks.length - 1,
    offsetWithinChunk: last.duration,
  };
}
