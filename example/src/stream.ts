import { fetch, TextDecoder } from 'react-native-nitro-fetch';

// Custom error types for better error handling
enum StreamErrors {
  NETWORK_ERROR = 'NETWORK_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
  ABORTED = 'ABORTED',
}

class StreamError extends Error {
  constructor(
    message: string,
    public code: StreamErrors
  ) {
    super(message);
    this.name = 'StreamError';
  }
}

interface FetchStreamOptions {
  url?: string;
  headers?: Record<string, string>;
  body?: any;
  signal?: AbortSignal;
  onData?: (data: any) => void;
  onStreamComplete?: () => void;
}

export async function fetchStreamedData(options: FetchStreamOptions = {}) {
  const {
    url = 'http://192.168.1.157:3000/stream',
    headers = {},
    body,
    signal,
    onData,
    onStreamComplete,
  } = options;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new StreamError(
        `HTTP error! status: ${response.status}`,
        StreamErrors.SERVER_ERROR
      );
    }

    if (!response.body) {
      throw new StreamError('No response body', StreamErrors.SERVER_ERROR);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    // Keep track of recent lines for debugging
    const recentLines: string[] = [];
    const MAX_RECENT_LINES = 3;

    onData?.({ type: 'client_stream_started' });

    while (true) {
      // Check if aborted
      if (signal?.aborted) {
        throw new StreamError(
          'Stream operation was aborted',
          StreamErrors.ABORTED
        );
      }

      const { done, value } = await reader.read();

      if (done) {
        console.log('Stream finished');
        break;
      }

      // Decode the chunk and add to buffer
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines efficiently
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line) {
          try {
            const data = JSON.parse(line);
            onData?.(data);

            // Track successfully parsed lines
            recentLines.push(line);
            if (recentLines.length > MAX_RECENT_LINES) {
              recentLines.shift();
            }
          } catch (parseError) {
            // Get context for debugging
            const nextNewlineIndex = buffer.indexOf('\n');
            const nextLine =
              nextNewlineIndex !== -1
                ? buffer.slice(0, nextNewlineIndex).trim()
                : buffer.slice(0, 200).trim(); // Show first 200 chars if no newline

            console.error('=== JSON Parse Error Context ===');
            console.error('Previous lines:');
            recentLines.forEach((prevLine, i) => {
              console.error(
                `  -${recentLines.length - i}: ${prevLine.slice(0, 150)}${
                  prevLine.length > 150 ? '...' : ''
                }`
              );
            });
            console.error('\nFailed line:');
            console.error(
              `  >>> ${line.slice(0, 500)}${line.length > 500 ? '...' : ''}`
            );
            console.error('\nNext line in buffer:');
            console.error(
              `  +1: ${nextLine.slice(0, 150)}${
                nextLine.length > 150 ? '...' : ''
              }`
            );
            console.error('\nError:', parseError);
            console.error('================================');

            throw new StreamError(
              `Parse error: ${
                parseError instanceof Error ? parseError.message : 'Unknown'
              }`,
              StreamErrors.PARSE_ERROR
            );
          }
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer);
        console.log('Final data:', data);
        onData?.(data);
      } catch (parseError) {
        console.error('=== JSON Parse Error Context (Final Buffer) ===');
        console.error('Previous lines:');
        recentLines.forEach((prevLine, i) => {
          console.error(
            `  -${recentLines.length - i}: ${prevLine.slice(0, 150)}${
              prevLine.length > 150 ? '...' : ''
            }`
          );
        });
        console.error('\nFailed final buffer:');
        console.error(
          `  >>> ${buffer.slice(0, 500)}${buffer.length > 500 ? '...' : ''}`
        );
        console.error('\nError:', parseError);
        console.error('===============================================');

        throw new StreamError(
          `Parse error on final buffer: ${
            parseError instanceof Error ? parseError.message : 'Unknown'
          }`,
          StreamErrors.PARSE_ERROR
        );
      }
    }
  } catch (error) {
    if (error instanceof StreamError) {
      console.error(`StreamError [${error.code}]:`, error.message);
      throw error;
    } else {
      const networkError = new StreamError(
        `Network error: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        StreamErrors.NETWORK_ERROR
      );
      console.error(networkError);
      throw networkError;
    }
  } finally {
    onStreamComplete?.();
  }
}
