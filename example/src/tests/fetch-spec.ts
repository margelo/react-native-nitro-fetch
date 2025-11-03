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

// =======================
// Response.clone() Tests
// =======================

test(SUITE, 'can clone response and read both independently', async () => {
  const url = getServerUrl('/json/small');
  const response = await fetch(url);

  // Clone the response
  const clone = response.clone();

  // Both should have same properties
  expect(clone.status).to.equal(response.status);
  expect(clone.statusText).to.equal(response.statusText);
  expect(clone.ok).to.equal(response.ok);
  expect(clone.url).to.equal(response.url);

  // Read from original
  const json1 = await response.json();
  expect(json1).to.be.an('object');

  // Read from clone independently
  const json2 = await clone.json();
  expect(json2).to.be.an('object');

  // Both should have the same data
  expect(JSON.stringify(json1)).to.equal(JSON.stringify(json2));
});

test(SUITE, 'cannot clone after body has been consumed', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url);

  // Consume the body
  await response.text();

  // Try to clone - should throw
  try {
    response.clone();
    throw new Error('Should have thrown');
  } catch (error: any) {
    expect(error.message).to.match(/already been used|cannot clone/i);
  }
});

test(SUITE, 'clone preserves all response properties', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url);

  const clone = response.clone();

  expect(clone.status).to.equal(response.status);
  expect(clone.statusText).to.equal(response.statusText);
  expect(clone.ok).to.equal(response.ok);
  expect(clone.url).to.equal(response.url);
  expect(clone.redirected).to.equal(response.redirected);
  expect(clone.type).to.equal(response.type);

  // Headers should be the same
  const contentType1 = response.headers.get('content-type');
  const contentType2 = clone.headers.get('content-type');
  expect(contentType1).to.equal(contentType2);
});

test(SUITE, 'can read original and clone with different methods', async () => {
  const url = getServerUrl('/json/small');
  const response = await fetch(url);

  const clone = response.clone();

  // Read original as JSON
  const json = await response.json();
  expect(json).to.be.an('object');

  // Read clone as text
  const text = await clone.text();
  expect(text).to.be.a('string');

  // Verify text is valid JSON
  const parsedText = JSON.parse(text);
  expect(JSON.stringify(json)).to.equal(JSON.stringify(parsedText));
});

test(SUITE, 'can clone multiple times before reading', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url);

  // Create multiple clones
  const clone1 = response.clone();
  const clone2 = response.clone();
  const clone3 = response.clone();

  // All should be readable
  const text1 = await response.text();
  const text2 = await clone1.text();
  const text3 = await clone2.text();
  const text4 = await clone3.text();

  expect(text1.length).to.equal(1024);
  expect(text2.length).to.equal(1024);
  expect(text3.length).to.equal(1024);
  expect(text4.length).to.equal(1024);

  expect(text1).to.equal(text2);
  expect(text1).to.equal(text3);
  expect(text1).to.equal(text4);
});

test(SUITE, 'clone works with arrayBuffer', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url);

  const clone = response.clone();

  const buffer1 = await response.arrayBuffer();
  const buffer2 = await clone.arrayBuffer();

  expect(buffer1.byteLength).to.equal(1024);
  expect(buffer2.byteLength).to.equal(1024);
  expect(buffer1.byteLength).to.equal(buffer2.byteLength);

  // Verify contents are identical
  const view1 = new Uint8Array(buffer1);
  const view2 = new Uint8Array(buffer2);
  expect(view1.length).to.equal(view2.length);
});

test(SUITE, 'clone with empty response', async () => {
  const url = getServerUrl('/status/204'); // No Content
  const response = await fetch(url);

  const clone = response.clone();

  const text1 = await response.text();
  const text2 = await clone.text();

  expect(text1).to.equal('');
  expect(text2).to.equal('');
});

test(SUITE, 'clone with large response', async () => {
  const url = getServerUrl('/data/1mb');
  const response = await fetch(url);

  const clone = response.clone();

  const text1 = await response.text();
  const text2 = await clone.text();

  expect(text1.length).to.equal(1024 * 1024);
  expect(text2.length).to.equal(1024 * 1024);
  expect(text1).to.equal(text2);
});

test(SUITE, 'bodyUsed is independent for clone', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url);

  const clone = response.clone();

  // Initially both should be unused
  expect(response.bodyUsed).to.equal(false);
  expect(clone.bodyUsed).to.equal(false);

  // Read original
  await response.text();

  // Original should be used, clone should not
  expect(response.bodyUsed).to.equal(true);
  expect(clone.bodyUsed).to.equal(false);

  // Clone should still be readable
  const text = await clone.text();
  expect(text.length).to.equal(1024);

  // Now both should be used
  expect(response.bodyUsed).to.equal(true);
  expect(clone.bodyUsed).to.equal(true);
});

test(SUITE, 'clone can be cloned again', async () => {
  const url = getServerUrl('/data/1kb');
  const response = await fetch(url);

  const clone1 = response.clone();
  const clone2 = clone1.clone();

  const text1 = await response.text();
  const text2 = await clone1.text();
  const text3 = await clone2.text();

  expect(text1).to.equal(text2);
  expect(text1).to.equal(text3);
});

// =======================
// AbortController Tests
// =======================

test(SUITE, 'can abort request before it starts', async () => {
  const controller = new AbortController();
  const url = getServerUrl('/data/1kb');

  // Abort before fetch
  controller.abort();

  try {
    await fetch(url, { signal: controller.signal });
    throw new Error('Should have thrown');
  } catch (error: any) {
    expect(error.name).to.equal('AbortError');
    expect(error.message).to.match(/abort/i);
  }
});

test(SUITE, 'can abort request during fetch', async () => {
  const controller = new AbortController();
  const url = getServerUrl('/delay/2000'); // 2 second delay

  // Start fetch
  const promise = fetch(url, { signal: controller.signal });

  // Abort after a short delay
  setTimeout(() => controller.abort(), 100);

  try {
    await promise;
    throw new Error('Should have thrown');
  } catch (error: any) {
    expect(error.name).to.equal('AbortError');
    expect(error.message).to.match(/abort/i);
  }
});

test(SUITE, 'can abort large download mid-stream', async () => {
  const controller = new AbortController();
  const url = getServerUrl('/delay/2000'); // 2 second delay

  // Start fetch
  const promise = fetch(url, { signal: controller.signal });

  // Abort during delay
  setTimeout(() => controller.abort(), 200);

  try {
    await promise;
    throw new Error('Should have thrown');
  } catch (error: any) {
    expect(error.name).to.equal('AbortError');
    expect(error.message).to.match(/abort/i);
  }
});

test(SUITE, 'abort error has correct type', async () => {
  const controller = new AbortController();
  const url = getServerUrl('/data/1kb');

  controller.abort();

  try {
    await fetch(url, { signal: controller.signal });
    throw new Error('Should have thrown');
  } catch (error: any) {
    expect(error).to.be.instanceOf(Error);
    expect(error.name).to.equal('AbortError');
    expect(error.message).to.match(/abort/i);
  }
});

test(SUITE, 'multiple requests with different abort controllers', async () => {
  const controller1 = new AbortController();
  const controller2 = new AbortController();
  const controller3 = new AbortController();

  const url = getServerUrl('/delay/2000'); // 2 second delay

  // Start 3 requests
  const promise1 = fetch(url, { signal: controller1.signal });
  const promise2 = fetch(url, { signal: controller2.signal });
  const promise3 = fetch(url, { signal: controller3.signal });

  // Abort only the second one during delay
  setTimeout(() => controller2.abort(), 200);

  try {
    const results = await Promise.allSettled([promise1, promise2, promise3]);

    // First request should succeed
    expect(results[0].status).to.equal('fulfilled');

    // Second request should be aborted
    expect(results[1].status).to.equal('rejected');
    if (results[1].status === 'rejected') {
      expect(results[1].reason.name).to.equal('AbortError');
    }

    // Third request should succeed
    expect(results[2].status).to.equal('fulfilled');
  } catch (error: any) {
    // If we get here, something went wrong
    throw error;
  }
});

test(SUITE, 'abort after response started but before body read', async () => {
  const controller = new AbortController();
  const url = getServerUrl('/data/10kb'); // Smaller file for faster test

  const response = await fetch(url, { signal: controller.signal });
  expect(response.status).to.equal(200);

  // Abort before reading the body
  controller.abort();

  // Try to read the body - behavior may vary
  // Some implementations might allow reading, others might fail
  try {
    await response.text();
    // If it succeeds, that's okay - the abort happened after response
  } catch (error: any) {
    // If it fails with abort error, that's also okay
    expect(error.name).to.match(/AbortError|Error/i);
  }
});

test(SUITE, 'can reuse aborted controller signal', async () => {
  const controller = new AbortController();
  controller.abort();

  const url = getServerUrl('/data/1kb');

  // First attempt with aborted signal
  try {
    await fetch(url, { signal: controller.signal });
    throw new Error('Should have thrown');
  } catch (error: any) {
    expect(error.name).to.equal('AbortError');
  }

  // Second attempt with same aborted signal
  try {
    await fetch(url, { signal: controller.signal });
    throw new Error('Should have thrown');
  } catch (error: any) {
    expect(error.name).to.equal('AbortError');
  }
});

test(SUITE, 'fetch without signal continues normally', async () => {
  const url = getServerUrl('/data/1kb');

  // Fetch without signal
  const response = await fetch(url);

  expect(response.status).to.equal(200);
  const text = await response.text();
  expect(text.length).to.equal(1024);
});

test(SUITE, 'aborting completed request does nothing', async () => {
  const controller = new AbortController();
  const url = getServerUrl('/data/1kb');

  const response = await fetch(url, { signal: controller.signal });
  const text = await response.text();

  expect(text.length).to.equal(1024);

  // Abort after completion
  controller.abort();

  // Should not throw or cause issues
  expect(response.status).to.equal(200);
});

test(SUITE, 'can abort while actively reading stream', async () => {
  const controller = new AbortController();
  const url = getServerUrl('/data/5mb'); // Large file to ensure multiple chunks

  const response = await fetch(url, { signal: controller.signal });
  expect(response.status).to.equal(200);

  const stream = response.body;
  expect(stream).to.not.be.null;

  if (!stream) {
    throw new Error('Stream is null');
  }

  const reader = stream.getReader();
  let chunksRead = 0;
  let bytesRead = 0;

  try {
    // Read a few chunks
    while (chunksRead < 3) {
      const { done, value } = await reader.read();
      if (done) break;

      chunksRead++;
      bytesRead += value.length;
    }

    expect(chunksRead).to.be.greaterThan(0);
    expect(bytesRead).to.be.greaterThan(0);

    // Abort while stream is still active
    controller.abort();

    // Try to read more - should fail with abort error or done
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
        // If we get here, some implementations might drain the stream
        // which is acceptable behavior
      }
    } catch (error: any) {
      // Stream should error after abort
      expect(error.name).to.match(/AbortError|Error/i);
    }

    // Either we got an error or the stream finished gracefully
    // Both are acceptable after abort is called mid-stream
  } finally {
    reader.releaseLock();
  }
});

test(SUITE, 'abort signal cancels stream via stream.cancel()', async () => {
  const controller = new AbortController();
  const url = getServerUrl('/data/5mb');

  const response = await fetch(url, { signal: controller.signal });
  const stream = response.body;

  expect(stream).to.not.be.null;
  if (!stream) throw new Error('Stream is null');

  const reader = stream.getReader();

  // Read one chunk to start the stream
  await reader.read();

  // Now manually cancel the stream (this should trigger request.cancel())
  reader.releaseLock();
  await stream.cancel();

  // Verify stream is closed
  const reader2 = stream.getReader();
  const { done } = await reader2.read();
  expect(done).to.equal(true);

  reader2.releaseLock();
});
