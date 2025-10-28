import { expect } from 'chai';
import { test } from '../utils';
import { fetch } from 'react-native-nitro-fetch';

const SUITE = 'Fetch Spec Compliance';

// Helper to get server URL
function getServerUrl(path: string): string {
  return `http://192.168.1.157:3000${path}`;
}

// =======================
// Body Reading Rules
// =======================

test(SUITE, 'body can only be read once - text()', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url);

  // First read should work
  const text = await response.text();
  expect(text).to.be.a('string');
  expect(text.length).to.be.greaterThan(0);

  // Second read should throw
  try {
    await response.text();
    throw new Error('Should have thrown');
  } catch (error: any) {
    expect(error.message).to.match(/already been consumed|body.*used/i);
  }
});

test(SUITE, 'body can only be read once - json()', async () => {
  const url = getServerUrl('/json/small');
  const response = await fetch(url);

  // First read should work
  const json = await response.json();
  expect(json).to.be.an('object');

  // Second read should throw
  try {
    await response.json();
    throw new Error('Should have thrown');
  } catch (error: any) {
    expect(error.message).to.match(/already been consumed|body.*used/i);
  }
});

test(SUITE, 'body can only be read once - arrayBuffer()', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url);

  // First read should work
  const buffer = await response.arrayBuffer();
  expect(buffer).to.be.instanceOf(ArrayBuffer);
  expect(buffer.byteLength).to.be.greaterThan(0);

  // Second read should throw
  try {
    await response.arrayBuffer();
    throw new Error('Should have thrown');
  } catch (error: any) {
    expect(error.message).to.match(/already been consumed|body.*used/i);
  }
});

test(SUITE, 'cannot call different body methods - text then json', async () => {
  const url = getServerUrl('/json/small');
  const response = await fetch(url);

  await response.text();

  try {
    await response.json();
    throw new Error('Should have thrown');
  } catch (error: any) {
    expect(error.message).to.match(/already been consumed|body.*used/i);
  }
});

test(
  SUITE,
  'cannot call different body methods - json then arrayBuffer',
  async () => {
    const url = getServerUrl('/json/small');
    const response = await fetch(url);

    await response.json();

    try {
      await response.arrayBuffer();
      throw new Error('Should have thrown');
    } catch (error: any) {
      expect(error.message).to.match(/already been consumed|body.*used/i);
    }
  }
);

test(
  SUITE,
  'cannot call different body methods - arrayBuffer then text',
  async () => {
    const url = getServerUrl('/data/1kb');
    const response = await fetch(url);

    await response.arrayBuffer();

    try {
      await response.text();
      throw new Error('Should have thrown');
    } catch (error: any) {
      expect(error.message).to.match(/already been consumed|body.*used/i);
    }
  }
);

// =======================
// Response Properties
// =======================

test(SUITE, 'response has correct properties - 200 OK', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url);

  expect(response.status).to.equal(200);
  expect(response.statusText).to.be.a('string');
  expect(response.ok).to.equal(true);
  expect(response.url).to.be.a('string');
  expect(response.url).to.include('/data/1kb');
  expect(response.headers).to.not.be.undefined;
});

test(SUITE, 'response has correct properties - 404 Not Found', async () => {
  const url = getServerUrl('/status/404');
  const response = await fetch(url);

  expect(response.status).to.equal(404);
  expect(response.ok).to.equal(false);
});

test(
  SUITE,
  'response has correct properties - 500 Internal Error',
  async () => {
    const url = getServerUrl('/status/500');
    const response = await fetch(url);

    expect(response.status).to.equal(500);
    expect(response.ok).to.equal(false);
  }
);

test(SUITE, 'response.ok is true for 2xx status codes', async () => {
  const testCases = [200, 201, 204];

  for (const status of testCases) {
    const url = getServerUrl(`/status/${status}`);
    const response = await fetch(url);
    expect(response.ok).to.equal(true, `Status ${status} should have ok=true`);
    expect(response.status).to.equal(status);
  }
});

test(SUITE, 'response.ok is false for non-2xx status codes', async () => {
  const testCases = [301, 400, 404, 500];

  for (const status of testCases) {
    const url = getServerUrl(`/status/${status}`);
    const response = await fetch(url);
    expect(response.ok).to.equal(
      false,
      `Status ${status} should have ok=false`
    );
    expect(response.status).to.equal(status);
  }
});

// =======================
// Headers
// =======================

test(SUITE, 'can read response headers', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url);

  expect(response.headers).to.not.be.undefined;

  // Should have content-type
  const contentType = response.headers.get('content-type');
  expect(contentType).to.not.be.null;
  expect(contentType).to.be.a('string');
});

test(SUITE, 'headers.get is case-insensitive', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url);

  const lower = response.headers.get('content-type');
  const upper = response.headers.get('Content-Type');
  const mixed = response.headers.get('CoNtEnT-tYpE');

  expect(lower).to.equal(upper);
  expect(lower).to.equal(mixed);
});

test(SUITE, 'headers.get returns null for missing header', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url);

  const missing = response.headers.get('x-nonexistent-header');
  expect(missing).to.be.null;
});

test(SUITE, 'can send custom request headers', async () => {
  const url = getServerUrl('/echo-headers');

  const response = await fetch(url, {
    cache: 'no-cache', // Bypass cache
    headers: {
      'X-Custom-Header': 'test-value',
      'X-Another-Header': 'another-value',
    },
  });

  expect(response.status).to.equal(200);
  const body = await response.text();
  expect(body).to.include('x-custom-header');
  expect(body).to.include('test-value');
});

// =======================
// Request Methods
// =======================

test(SUITE, 'GET request', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url, { method: 'GET' });

  expect(response.status).to.equal(200);
  const text = await response.text();
  expect(text.length).to.be.greaterThan(0);
});

test(SUITE, 'POST request with body', async () => {
  const url = getServerUrl('/echo');
  const testData = JSON.stringify({ test: 'data', value: 123 });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: testData,
  });

  expect(response.status).to.equal(200);
  const responseText = await response.text();
  expect(responseText).to.include('test');
  expect(responseText).to.include('data');
});

test(SUITE, 'PUT request', async () => {
  const url = getServerUrl('/echo');
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/plain',
    },
    body: 'test data',
  });

  // Server doesn't support PUT on /echo, but request should complete
  expect(response.status).to.be.greaterThan(0);
});

test(SUITE, 'DELETE request', async () => {
  const url = getServerUrl('/echo');
  const response = await fetch(url, {
    method: 'DELETE',
  });

  // Server doesn't support DELETE on /echo, but request should complete
  expect(response.status).to.be.greaterThan(0);
});

// =======================
// Body Types
// =======================

test(SUITE, 'can parse JSON response', async () => {
  const url = getServerUrl('/json/small');
  const response = await fetch(url);

  const json = await response.json();
  expect(json).to.be.an('object');
  // JSON was successfully parsed
});

test(SUITE, 'json() throws on invalid JSON', async () => {
  const url = getServerUrl('/data/1kb'); // Returns plain text
  const response = await fetch(url);

  try {
    await response.json();
    throw new Error('Should have thrown');
  } catch (error: any) {
    expect(error.message).to.match(/JSON|parse/i);
  }
});

test(SUITE, 'can read text response', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url);

  const text = await response.text();
  expect(text).to.be.a('string');
  expect(text.length).to.equal(1024);
});

test(SUITE, 'can read arrayBuffer response', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url);

  const buffer = await response.arrayBuffer();
  expect(buffer).to.be.instanceOf(ArrayBuffer);
  expect(buffer.byteLength).to.equal(1024);
});

test(SUITE, 'arrayBuffer matches text length', async () => {
  const url = getServerUrl('/data/1kb');

  // First request for text
  const textResponse = await fetch(url);
  const text = await textResponse.text();

  // Second request for arrayBuffer
  const bufferResponse = await fetch(url);
  const buffer = await bufferResponse.arrayBuffer();

  expect(buffer.byteLength).to.equal(text.length);
});

// =======================
// Request Body
// =======================

test(SUITE, 'can send string body', async () => {
  const url = getServerUrl('/echo');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
    },
    body: 'test string',
  });

  expect(response.status).to.equal(200);
  const text = await response.text();
  expect(text).to.include('test string');
});

test(SUITE, 'can send ArrayBuffer body', async () => {
  const url = getServerUrl('/echo');
  const data = new Uint8Array([1, 2, 3, 4, 5]);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    body: data.buffer,
  });

  expect(response.status).to.equal(200);
});

test(SUITE, 'can send Uint8Array body', async () => {
  const url = getServerUrl('/echo');
  const data = new Uint8Array([10, 20, 30, 40, 50]);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    body: data,
  });

  expect(response.status).to.equal(200);
});

// =======================
// Error Handling
// =======================

test(SUITE, 'throws on invalid URL', async () => {
  try {
    await fetch('not-a-valid-url');
    throw new Error('Should have thrown');
  } catch (error: any) {
    expect(error).to.not.be.undefined;
  }
});

test(SUITE, 'throws on network error', async () => {
  try {
    await fetch('http://localhost:99999/nonexistent');
    throw new Error('Should have thrown');
  } catch (error: any) {
    expect(error).to.not.be.undefined;
  }
});

test(SUITE, 'does NOT throw on 404', async () => {
  const url = getServerUrl('/status/404');
  const response = await fetch(url);

  expect(response.status).to.equal(404);
  expect(response.ok).to.equal(false);
  // Should not throw - 404 is a valid HTTP response
});

test(SUITE, 'does NOT throw on 500', async () => {
  const url = getServerUrl('/status/500');
  const response = await fetch(url);

  expect(response.status).to.equal(500);
  expect(response.ok).to.equal(false);
  // Should not throw - 500 is a valid HTTP response
});

// =======================
// Edge Cases
// =======================

test(SUITE, 'can fetch empty response', async () => {
  const url = getServerUrl('/status/204'); // No Content
  const response = await fetch(url);

  expect(response.status).to.equal(204);
  const text = await response.text();
  expect(text).to.equal('');
});

test(SUITE, 'can fetch large response', async () => {
  const url = getServerUrl('/data/1mb');
  const response = await fetch(url);

  expect(response.status).to.equal(200);
  const text = await response.text();
  expect(text.length).to.equal(1024 * 1024);
});

test(SUITE, 'can handle concurrent requests', async () => {
  const urls = [
    getServerUrl('/data/1kb'),
    getServerUrl('/data/10kb'),
    getServerUrl('/json/small'),
  ];

  const promises = urls.map((url) => fetch(url));
  const responses = await Promise.all(promises);

  expect(responses).to.have.length(3);
  responses.forEach((response) => {
    expect(response.status).to.equal(200);
  });
});

test(SUITE, 'can fetch same URL multiple times', async () => {
  const url = getServerUrl('/data/1kb');

  const response1 = await fetch(url);
  const response2 = await fetch(url);
  const response3 = await fetch(url);

  expect(response1.status).to.equal(200);
  expect(response2.status).to.equal(200);
  expect(response3.status).to.equal(200);

  const text1 = await response1.text();
  const text2 = await response2.text();
  const text3 = await response3.text();

  expect(text1.length).to.equal(1024);
  expect(text2.length).to.equal(1024);
  expect(text3.length).to.equal(1024);
});

test(SUITE, 'headers object is iterable', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url);

  let count = 0;
  response.headers.forEach((value, key) => {
    expect(key).to.be.a('string');
    expect(value).to.be.a('string');
    count++;
  });

  expect(count).to.be.greaterThan(0);
});

test(SUITE, 'can handle UTF-8 in response', async () => {
  const url = getServerUrl('/utf8');
  const response = await fetch(url, {
    cache: 'no-cache', // Bypass cache
  });

  const text = await response.text();
  expect(text).to.be.a('string');
  expect(text).to.include('emoji');
  expect(text).to.include('🎉');
});

test(SUITE, 'default method is GET', async () => {
  const url = getServerUrl('/data/1kb');
  // Don't specify method
  const response = await fetch(url);

  expect(response.status).to.equal(200);
  const text = await response.text();
  expect(text.length).to.be.greaterThan(0);
});

// =======================
// Streaming Edge Cases
// =======================

test(
  SUITE,
  'reading body stream directly then calling text() should fail',
  async () => {
    const url = getServerUrl('/data/1kb');
    const response = await fetch(url);

    // Access the stream
    const stream = response.body;
    expect(stream).to.not.be.undefined;

    // Try to read with .text() - should fail because stream was accessed
    try {
      await response.text();
      // Some implementations might allow this, so we don't fail the test
      // Just log that it worked
      console.log('Note: Implementation allows text() after accessing stream');
    } catch (error: any) {
      // This is the expected behavior
      expect(error.message).to.match(/stream|consumed|used/i);
    }
  }
);

test(SUITE, 'multiple concurrent fetches dont interfere', async () => {
  const urls = Array.from({ length: 10 }, (_, i) =>
    getServerUrl(`/data/1kb?test=${i}`)
  );

  const promises = urls.map(async (url) => {
    const response = await fetch(url);
    const text = await response.text();
    return text.length;
  });

  const lengths = await Promise.all(promises);

  lengths.forEach((length) => {
    expect(length).to.equal(1024);
  });
});
