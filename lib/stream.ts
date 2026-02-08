/** Pipe a ReadableStream to a Deno.FsFile (e.g. a log file). */
export const pipeStreamToFile = async (
  stream: ReadableStream<Uint8Array>,
  file: Deno.FsFile,
): Promise<void> => {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await file.write(value);
    }
  } finally {
    reader.releaseLock();
  }
};
