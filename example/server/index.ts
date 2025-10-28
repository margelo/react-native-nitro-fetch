const PORT = 3000;

// Helper to generate deterministic data (same output for same size every time)
function generateDeterministicData(sizeInBytes: number): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < sizeInBytes; i++) {
    // Use modulo for deterministic pattern
    result += chars.charAt(i % chars.length);
  }
  return result;
}

// Helper to generate binary data (deterministic)
function generateBinaryData(sizeInBytes: number): Uint8Array {
  const data = new Uint8Array(sizeInBytes);
  for (let i = 0; i < sizeInBytes; i++) {
    // Use deterministic pattern based on position
    data[i] = i % 256;
  }
  return data;
}

// Helper to generate JSON objects (deterministic)
function generateLargeJSON(numItems: number) {
  return {
    timestamp: 1234567890, // Fixed timestamp for deterministic comparison
    items: Array.from({ length: numItems }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      description: `This is a description for item ${i}`,
      value: (i * 123.456) % 1000, // Deterministic value based on index
      tags: ['tag1', 'tag2', 'tag3'],
      metadata: {
        created: '2024-01-01T00:00:00.000Z', // Fixed date
        updated: '2024-01-01T00:00:00.000Z', // Fixed date
        version: 1,
      },
    })),
  };
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Check if client wants caching (by absence of cache-busting headers/params)
    const clientWantsCache =
      !url.searchParams.has('_') && // No cache-busting param
      req.headers.get('cache-control') !==
        'no-cache, no-store, must-revalidate';

    // Helper to get headers (with or without caching)
    const getHeaders = (
      cacheable: boolean = clientWantsCache
    ): Record<string, string> => {
      const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

      if (cacheable) {
        // Allow caching
        return {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Expose-Headers':
            'X-Request-Id, X-Request-Time, X-Cacheable, X-Fresh-Response, X-Generation-Time, X-Data-Size, X-Item-Count, X-Delay, X-Chunk-Count, X-Chunk-Delay, ETag, Last-Modified',
          'Cache-Control': 'public, max-age=3600',
          'ETag': `"${uniqueId}"`,
          'Last-Modified': new Date().toUTCString(),
          'X-Cacheable': 'true',
          'X-Request-Id': uniqueId,
          'X-Request-Time': new Date().toISOString(),
        };
      } else {
        // Prevent caching
        return {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Expose-Headers':
            'X-Request-Id, X-Request-Time, X-Cacheable, X-Fresh-Response, X-Generation-Time, X-Data-Size, X-Item-Count, X-Delay, X-Chunk-Count, X-Chunk-Delay',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'X-Request-Id': uniqueId,
          'X-Server-Time': new Date().toISOString(),
          'X-Fresh-Response': 'true',
          'Age': '0',
        };
      }
    };

    const corsHeaders = getHeaders();

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Root endpoint - API documentation
    if (path === '/' || path === '/api') {
      return new Response(
        JSON.stringify(
          {
            message: 'NitroFetch Speed Test API',
            endpoints: {
              '/': 'This documentation',
              '/health': 'Health check endpoint',
              '/echo': 'POST endpoint - echoes back the request body',
              '/echo-headers': 'Returns request headers in response body',
              '/utf8': 'UTF-8 test endpoint with emojis and special characters',
              '/data/:size':
                'Download text data (sizes: 1kb, 10kb, 100kb, 1mb, 5mb, 10mb, 50mb, 100mb)',
              '/json/:size':
                'JSON response (sizes: small, medium, large, xlarge)',
              '/binary/:size':
                'Binary data download (sizes: 1kb, 100kb, 1mb, 5mb, 10mb, 50mb)',
              '/stream':
                'JSON streaming endpoint - newline-delimited JSON (query params: ?chunks=10&delay=100)',
              '/stream/:chunks/:delay':
                'Text streaming response (chunks: number of chunks, delay: ms between chunks)',
              '/delay/:ms': 'Delayed response (ms: milliseconds to delay)',
              '/headers': 'Returns request headers as JSON',
              '/status/:code': 'Returns specified HTTP status code',
              '/image': 'Returns a random image (simulated)',
              '/chunked': 'Chunked transfer encoding response',
              '/large-headers': 'Response with many custom headers',
            },
          },
          null,
          2
        ),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Health check
    if (path === '/health') {
      return new Response(
        JSON.stringify({ status: 'ok', timestamp: Date.now() }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Echo POST endpoint - returns back what was sent
    if (path === '/echo' && req.method === 'POST') {
      const body = await req.text();
      const contentType = req.headers.get('content-type') || 'text/plain';

      return new Response(
        JSON.stringify({
          success: true,
          receivedBytes: body.length,
          contentType: contentType,
          body: body,
          timestamp: Date.now(),
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'X-Received-Bytes': body.length.toString(),
          },
        }
      );
    }

    // Text data endpoints
    if (path.startsWith('/data/')) {
      const size = path.split('/')[2];
      const sizeMap: Record<string, number> = {
        '1kb': 1024,
        '10kb': 10 * 1024,
        '100kb': 100 * 1024,
        '1mb': 1024 * 1024,
        '5mb': 5 * 1024 * 1024,
        '10mb': 10 * 1024 * 1024,
        '50mb': 50 * 1024 * 1024,
        '100mb': 100 * 1024 * 1024,
      };

      const bytes = sizeMap[size.toLowerCase()];
      if (!bytes) {
        return new Response(
          'Invalid size. Use: 1kb, 10kb, 100kb, 1mb, 5mb, 10mb, 50mb, 100mb',
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      const startTime = Date.now();
      const data = generateDeterministicData(bytes);
      const generationTime = Date.now() - startTime;

      // Log server hit - if cached, this won't appear
      const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
      const cacheControl = req.headers.get('cache-control');
      const isCacheBypassed =
        cacheControl?.includes('no-cache') ||
        cacheControl?.includes('no-store');
      console.log(
        `[${timestamp}] 🌐 SERVER HIT: /data/${size} ${url.search} ${isCacheBypassed ? '(cache bypassed)' : '(cacheable)'} - Generated in ${generationTime}ms`
      );

      return new Response(data, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/plain',
          'Content-Length': bytes.toString(),
          'X-Generation-Time': `${generationTime}ms`,
          'X-Data-Size': size,
        },
      });
    }

    // Cache test endpoint - with detailed server logging
    if (path === '/cache-test') {
      const serverTimestamp = Date.now();
      const requestId = `${serverTimestamp}-${Math.random().toString(36).substring(7)}`;
      const logTimestamp = new Date().toISOString().split('T')[1].slice(0, -1);
      const cacheControl = req.headers.get('cache-control');
      const isCacheBypassed =
        cacheControl?.includes('no-cache') ||
        cacheControl?.includes('no-store');

      // Clear server-side log - if you see this, the request HIT THE SERVER
      console.log(`\n${'='.repeat(80)}`);
      console.log(`[${logTimestamp}] 🔴 SERVER HIT: /cache-test`);
      console.log(`  Request ID: ${requestId}`);
      console.log(`-------${cacheControl}`);
      console.log(
        `  Status: ${isCacheBypassed ? '❌ CACHE BYPASSED' : '✅ CACHEABLE'}`
      );
      console.log(`  Query: ${url.search || '(none)'}`);
      console.log(`${'='.repeat(80)}\n`);

      const responseData = {
        message: 'Cache test endpoint',
        serverTimestamp,
        requestId,
        serverTime: new Date().toISOString(),
        cacheable: !isCacheBypassed,
        info: 'If you see the same requestId and serverTimestamp, the response was cached',
      };

      return new Response(JSON.stringify(responseData, null, 2), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
          'X-Server-Timestamp': serverTimestamp.toString(),
        },
      });
    }

    // Cacheable test endpoint (100 KB of data)
    if (path === '/cacheable/test') {
      const data = generateDeterministicData(100 * 1024); // 100 KB
      const headers = getHeaders(true); // Always allow caching for this endpoint

      return new Response(data, {
        status: 200,
        headers: {
          ...headers,
          'Content-Type': 'text/plain',
          'Content-Length': (100 * 1024).toString(),
        },
      });
    }

    // JSON endpoints
    if (path.startsWith('/json/')) {
      const size = path.split('/')[2];
      const sizeMap: Record<string, number> = {
        small: 10,
        medium: 100,
        large: 1000,
        xlarge: 10000,
      };

      const numItems = sizeMap[size.toLowerCase()];
      if (!numItems) {
        return new Response('Invalid size. Use: small, medium, large, xlarge', {
          status: 400,
          headers: corsHeaders,
        });
      }

      const data = generateLargeJSON(numItems);
      const json = JSON.stringify(data);

      // Log server hit
      const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
      const cacheControl = req.headers.get('cache-control');
      const isCacheBypassed =
        cacheControl?.includes('no-cache') ||
        cacheControl?.includes('no-store');
      console.log(
        `[${timestamp}] 🌐 SERVER HIT: /json/${size} ${url.search} ${isCacheBypassed ? '(cache bypassed)' : '(cacheable)'}`
      );

      return new Response(json, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Content-Length': json.length.toString(),
          'X-Item-Count': numItems.toString(),
        },
      });
    }

    // Binary data endpoints
    if (path.startsWith('/binary/')) {
      const size = path.split('/')[2];
      const sizeMap: Record<string, number> = {
        '1kb': 1024,
        '100kb': 100 * 1024,
        '1mb': 1024 * 1024,
        '5mb': 5 * 1024 * 1024,
        '10mb': 10 * 1024 * 1024,
        '50mb': 50 * 1024 * 1024,
      };

      const bytes = sizeMap[size.toLowerCase()];
      if (!bytes) {
        return new Response(
          'Invalid size. Use: 1kb, 100kb, 1mb, 5mb, 10mb, 50mb',
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      const data = generateBinaryData(bytes);

      return new Response(data, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/octet-stream',
          'Content-Length': bytes.toString(),
          'Content-Disposition': `attachment; filename="data-${size}.bin"`,
        },
      });
    }

    // JSON streaming endpoint (newline-delimited JSON)
    if (path === '/stream') {
      const chunks = parseInt(url.searchParams.get('chunks') || '10', 10);
      const delay = parseInt(url.searchParams.get('delay') || '100', 10);

      const stream = new ReadableStream({
        async start(controller) {
          for (let i = 0; i < chunks; i++) {
            const data = {
              type: 'chunk',
              index: i + 1,
              total: chunks,
              timestamp: Date.now(),
              data: `Chunk data ${i + 1}`,
              progress: ((i + 1) / chunks) * 100,
            };
            const line = JSON.stringify(data) + '\n';
            controller.enqueue(new TextEncoder().encode(line));
            if (i < chunks - 1) {
              await Bun.sleep(delay);
            }
          }
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/x-ndjson',
          'Transfer-Encoding': 'chunked',
          'X-Chunk-Count': chunks.toString(),
          'X-Chunk-Delay': `${delay}ms`,
        },
      });
    }

    // Streaming endpoint (text chunks)
    if (path.startsWith('/stream/')) {
      const parts = path.split('/');
      const chunks = parseInt(parts[2]) || 10;
      const delay = parseInt(parts[3]) || 100;

      const stream = new ReadableStream({
        async start(controller) {
          for (let i = 0; i < chunks; i++) {
            const chunk = `Chunk ${i + 1}/${chunks}\n`;
            controller.enqueue(new TextEncoder().encode(chunk));
            if (i < chunks - 1) {
              await Bun.sleep(delay);
            }
          }
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/plain',
          'Transfer-Encoding': 'chunked',
          'X-Chunk-Count': chunks.toString(),
          'X-Chunk-Delay': `${delay}ms`,
        },
      });
    }

    // Delayed response
    if (path.startsWith('/delay/')) {
      const ms = parseInt(path.split('/')[2]) || 1000;
      await Bun.sleep(ms);

      return new Response(
        JSON.stringify({
          message: `Response delayed by ${ms}ms`,
          timestamp: Date.now(),
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'X-Delay': `${ms}ms`,
          },
        }
      );
    }

    // Headers endpoint
    if (path === '/headers') {
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return new Response(JSON.stringify({ headers }, null, 2), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Echo headers endpoint - returns headers in response body
    if (path === '/echo-headers') {
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return new Response(JSON.stringify(headers, null, 2), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // UTF-8 test endpoint with emojis
    if (path === '/utf8') {
      // Log server hit
      const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
      const cacheControl = req.headers.get('cache-control');
      const isCacheBypassed =
        cacheControl?.includes('no-cache') ||
        cacheControl?.includes('no-store');
      console.log(
        `[${timestamp}] 🌐 SERVER HIT: /utf8 ${url.search} ${isCacheBypassed ? '(cache bypassed)' : '(cacheable)'}`
      );

      const utf8Content = {
        message: 'UTF-8 test with emoji support 🎉',
        emojis: '😀 😃 😄 😁 🚀 ⚡ 💻 🔥 ✨ 🌟',
        special: 'Héllo Wörld! Ñoño café',
        chinese: '你好世界',
        japanese: 'こんにちは世界',
        arabic: 'مرحبا بالعالم',
        symbols: '€ £ ¥ ₹ © ® ™',
      };

      return new Response(JSON.stringify(utf8Content, null, 2), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json; charset=utf-8',
        },
      });
    }

    // Status code endpoint
    if (path.startsWith('/status/')) {
      const code = parseInt(path.split('/')[2]) || 200;
      return new Response(
        JSON.stringify({ status: code, message: `Status code ${code}` }),
        {
          status: code,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Image endpoint (simulated)
    if (path === '/image') {
      const size = 1024 * 1024; // 1MB image
      const imageData = generateBinaryData(size);

      return new Response(imageData, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'image/jpeg',
          'Content-Length': size.toString(),
        },
      });
    }

    // Chunked transfer encoding
    if (path === '/chunked') {
      const chunks = [
        'First chunk of data\n',
        'Second chunk of data\n',
        'Third chunk of data\n',
        'Final chunk of data\n',
      ];

      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
            await Bun.sleep(100);
          }
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/plain',
          'Transfer-Encoding': 'chunked',
        },
      });
    }

    // Large headers endpoint
    if (path === '/large-headers') {
      const customHeaders: Record<string, string> = { ...corsHeaders };
      for (let i = 0; i < 50; i++) {
        customHeaders[`X-Custom-Header-${i}`] =
          `Value-${i}-${generateRandomData(100)}`;
      }

      return new Response(
        JSON.stringify({ message: 'Response with many headers' }),
        {
          status: 200,
          headers: { ...customHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // 404 for unknown endpoints
    return new Response('Not Found', {
      status: 404,
      headers: corsHeaders,
    });
  },
});

console.log(
  `🚀 NitroFetch Speed Test Server running at http://localhost:${PORT}`
);
console.log(`📚 API Documentation: http://localhost:${PORT}/api`);
