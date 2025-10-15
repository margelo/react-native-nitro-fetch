# NitroFetch Speed Test Server

A Bun-powered HTTP server with various endpoints for testing and benchmarking the NitroFetch library.

## Quick Start

Install dependencies and run:

```bash
bun install
bun run index.ts
```

The server will start at `http://localhost:3000`

## API Endpoints

### Documentation

- `GET /` or `GET /api` - API documentation (JSON)
- `GET /health` - Health check endpoint

### Download Speed Testing

- `GET /data/:size` - Download text data
  - Sizes: `1kb`, `10kb`, `100kb`, `1mb`, `10mb`, `50mb`, `100mb`
  - Example: `GET /data/10mb`

- `GET /binary/:size` - Download binary data
  - Sizes: `1kb`, `100kb`, `1mb`, `10mb`, `50mb`
  - Example: `GET /binary/1mb`

- `GET /image` - Download a simulated 1MB JPEG image

### JSON Response Testing

- `GET /json/:size` - JSON response with varying data sizes
  - Sizes: `small` (10 items), `medium` (100 items), `large` (1000 items), `xlarge` (10000 items)
  - Example: `GET /json/large`

### Streaming & Chunked Responses

- `GET /stream/:chunks/:delay` - Streaming response with configurable chunks
  - `:chunks` - Number of chunks to send
  - `:delay` - Delay in milliseconds between chunks
  - Example: `GET /stream/20/100` (20 chunks, 100ms delay)

- `GET /chunked` - Chunked transfer encoding response with 4 chunks

### Latency Testing

- `GET /delay/:ms` - Delayed response
  - `:ms` - Delay in milliseconds
  - Example: `GET /delay/3000` (3 second delay)

### Headers & Status Codes

- `GET /headers` - Returns all request headers as JSON
- `GET /status/:code` - Returns specified HTTP status code
  - Example: `GET /status/404`
- `GET /large-headers` - Response with 50+ custom headers

## Usage Examples

### Basic Speed Test

```typescript
// Test download speed with 10MB file
const start = Date.now();
const response = await fetch('http://localhost:3000/data/10mb');
const data = await response.text();
const duration = Date.now() - start;
console.log(`Downloaded ${data.length} bytes in ${duration}ms`);
console.log(`Speed: ${data.length / 1024 / 1024 / (duration / 1000)} MB/s`);
```

### JSON Parsing Performance

```typescript
const response = await fetch('http://localhost:3000/json/large');
const json = await response.json();
console.log(`Parsed ${json.items.length} items`);
```

### Streaming Test

```typescript
const response = await fetch('http://localhost:3000/stream/10/200');
const reader = response.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log('Chunk received:', new TextDecoder().decode(value));
}
```

### Latency Test

```typescript
const start = Date.now();
await fetch('http://localhost:3000/delay/1000');
console.log(`Request completed in ${Date.now() - start}ms`);
```

## CORS

All endpoints support CORS with `Access-Control-Allow-Origin: *` for easy testing from any origin.

## Notes

- All data is randomly generated on each request
- Binary and text data generation may take a moment for very large sizes (50MB+)
- The server includes generation time in response headers (`X-Generation-Time`)
- Responses include helpful metadata in custom headers

---

This project was created using `bun init` in bun v1.2.18. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
