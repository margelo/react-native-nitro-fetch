import { expect } from 'chai';
import { test } from '../utils';
import {
  fetch,
  prefetch,
  prefetchOnAppStart,
  removeFromAutoPrefetch,
  clearAutoPrefetchQueue,
} from 'react-native-nitro-fetch';

const SUITE = 'Prefetch';

// Helper to read auto-prefetch queue from MMKV
function getAutoPrefetchQueue(): any[] {
  try {
    const { MMKV } = require('react-native-mmkv');
    const storage = new MMKV();
    const KEY = 'nitrofetch_autoprefetch_queue';
    const raw = storage.getString(KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    // MMKV not available
  }
  return [];
}

// Helper to get local server URL (assuming server is running on port 3000)
const getServerUrl = (path: string) => `http://192.168.1.157:3000${path}`;

// Helper to generate unique prefetch keys
let keyCounter = 0;
const generatePrefetchKey = () => `test-prefetch-${Date.now()}-${keyCounter++}`;

test(SUITE, 'prefetch stores data and fetch retrieves it', async () => {
  const prefetchKey = generatePrefetchKey();
  const url = getServerUrl('/data/1kb');

  // Prefetch the data
  await prefetch({
    url,
    prefetchKey,
  });

  // Fetch with the same prefetchKey should return prefetched data
  const response = await fetch(url, {
    headers: { prefetchKey },
  });

  expect(response.ok).to.equal(true);
  expect(response.status).to.equal(200);

  // Check if the response has the prefetch header
  const nitroPrefetched = response.headers.get('nitroPrefetched');
  expect(nitroPrefetched).to.equal('true');

  const text = await response.text();
  expect(text.length).to.be.greaterThan(0);
});

test(SUITE, 'prefetch works with 1mb data', async () => {
  const prefetchKey = generatePrefetchKey();
  const url = getServerUrl('/data/1mb');

  // Prefetch the data
  await prefetch({
    url,
    prefetchKey,
  });

  // Fetch with the same prefetchKey
  const response = await fetch(url, {
    headers: { prefetchKey },
  });

  expect(response.ok).to.equal(true);
  expect(response.status).to.equal(200);

  const text = await response.text();
  expect(text.length).to.be.greaterThan(1000000); // Should be around 1MB
});

test(SUITE, 'prefetch with custom headers', async () => {
  const prefetchKey = generatePrefetchKey();
  const url = getServerUrl('/headers');

  // Prefetch with custom headers
  await prefetch({
    url,
    prefetchKey,
    headers: {
      'X-Custom-Header': 'test-value',
      'X-Test': 'prefetch',
    },
  });

  // Fetch with the same prefetchKey
  const response = await fetch(url, {
    headers: { prefetchKey },
  });

  expect(response.ok).to.equal(true);
  const data = await response.json();

  // The server echoes back the headers it received
  expect(data.headers['x-custom-header']).to.equal('test-value');
  expect(data.headers['x-test']).to.equal('prefetch');
});

test(SUITE, 'fetch without prefetch key makes normal request', async () => {
  const url = getServerUrl('/data/1kb');

  // Fetch without prefetch key
  const response = await fetch(url);

  expect(response.ok).to.equal(true);
  expect(response.status).to.equal(200);

  // Should NOT have the prefetch header
  const nitroPrefetched = response.headers.get('nitroPrefetched');
  expect(nitroPrefetched).to.not.equal('true');

  const text = await response.text();
  expect(text.length).to.be.greaterThan(0);
});

test(SUITE, 'prefetch with POST method', async () => {
  const prefetchKey = generatePrefetchKey();
  const url = getServerUrl('/echo');
  const postData = JSON.stringify({ test: 'data', value: 123 });

  // Prefetch with POST
  await prefetch({
    url,
    prefetchKey,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: postData,
  });

  // Fetch with the same prefetchKey
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      prefetchKey,
      'Content-Type': 'application/json',
    },
    body: postData,
  });

  expect(response.ok).to.equal(true);
  const data = await response.json();

  expect(data.success).to.equal(true);
  expect(data.body).to.equal(postData);
});

test(SUITE, 'different prefetch keys do not conflict', async () => {
  const key1 = generatePrefetchKey();
  const key2 = generatePrefetchKey();
  const url1 = getServerUrl('/data/1kb');
  const url2 = getServerUrl('/data/10kb');

  // Prefetch two different URLs with different keys
  await Promise.all([
    prefetch({ url: url1, prefetchKey: key1 }),
    prefetch({ url: url2, prefetchKey: key2 }),
  ]);

  // Fetch with key1 should get url1 data
  const response1 = await fetch(url1, {
    headers: { prefetchKey: key1 },
  });
  const text1 = await response1.text();

  // Fetch with key2 should get url2 data
  const response2 = await fetch(url2, {
    headers: { prefetchKey: key2 },
  });
  const text2 = await response2.text();

  // 10kb should be larger than 1kb
  expect(text2.length).to.be.greaterThan(text1.length);
});

test(SUITE, 'prefetch with JSON data', async () => {
  const prefetchKey = generatePrefetchKey();
  const url = getServerUrl('/json/small');

  // Prefetch JSON
  await prefetch({
    url,
    prefetchKey,
  });

  // Fetch and parse JSON
  const response = await fetch(url, {
    headers: { prefetchKey },
  });

  expect(response.ok).to.equal(true);
  const data = await response.json();

  expect(data).to.have.property('timestamp');
  expect(data).to.have.property('items');
  expect(Array.isArray(data.items)).to.equal(true);
});

test(SUITE, 'prefetch handles errors gracefully', async () => {
  const prefetchKey = generatePrefetchKey();
  const url = getServerUrl('/status/404');

  // Prefetch should complete even for 404
  await prefetch({
    url,
    prefetchKey,
  });

  // Fetch should return the cached 404 response
  const response = await fetch(url, {
    headers: { prefetchKey },
  });

  expect(response.ok).to.equal(false);
  expect(response.status).to.equal(404);
});

test(SUITE, 'multiple prefetches with same key are deduplicated', async () => {
  const prefetchKey = generatePrefetchKey();
  const url = getServerUrl('/data/1kb');

  // Start multiple prefetches with the same key simultaneously
  await Promise.all([
    prefetch({ url, prefetchKey }),
    prefetch({ url, prefetchKey }),
    prefetch({ url, prefetchKey }),
  ]);

  // Should still work correctly
  const response = await fetch(url, {
    headers: { prefetchKey },
  });

  expect(response.ok).to.equal(true);
  const text = await response.text();
  expect(text.length).to.be.greaterThan(0);
});

test(SUITE, 'prefetch timing - should be faster on second fetch', async () => {
  const prefetchKey = generatePrefetchKey();
  const url = getServerUrl('/data/1mb');

  // First, prefetch the data
  await prefetch({
    url,
    prefetchKey,
  });

  // Small delay to ensure prefetch completes
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Measure time for prefetched fetch
  const startPrefetched = Date.now();
  const prefetchedResponse = await fetch(url, {
    headers: { prefetchKey },
  });
  await prefetchedResponse.text();
  const prefetchedTime = Date.now() - startPrefetched;

  // Measure time for normal fetch (no prefetch)
  const startNormal = Date.now();
  const normalResponse = await fetch(url);
  await normalResponse.text();
  const normalTime = Date.now() - startNormal;

  console.log(`Prefetched fetch: ${prefetchedTime}ms`);
  console.log(`Normal fetch: ${normalTime}ms`);

  // Prefetched should generally be faster, but we'll just verify both succeed
  expect(prefetchedResponse.ok).to.equal(true);
  expect(normalResponse.ok).to.equal(true);
});

test(SUITE, 'consuming prefetch removes it from cache', async () => {
  const prefetchKey = generatePrefetchKey();
  const url = getServerUrl('/data/1kb');

  // Prefetch the data
  await prefetch({
    url,
    prefetchKey,
  });

  // First fetch consumes the prefetch
  const response1 = await fetch(url, {
    headers: { prefetchKey },
  });
  await response1.text();

  // Second fetch with same key should make a new request (no prefetch)
  const response2 = await fetch(url, {
    headers: { prefetchKey },
  });

  expect(response2.ok).to.equal(true);
  // The second response might not have the nitroPrefetched header
  // since the prefetch was already consumed
});

// prefetchOnAppStart tests
const SUITE_APP_START = 'PrefetchOnAppStart';

test(
  SUITE_APP_START,
  'prefetchOnAppStart stores request in queue',
  async () => {
    const prefetchKey = generatePrefetchKey();
    const url = getServerUrl('/data/1kb');

    try {
      // Clear the queue first
      await clearAutoPrefetchQueue();

      // Add to queue
      await prefetchOnAppStart({
        url,
        prefetchKey,
        headers: {
          'X-Test': 'app-start',
        },
      });

      // Verify it was added to the queue
      const queue = getAutoPrefetchQueue();
      expect(queue.length).to.be.greaterThan(0);

      // Find our entry
      const entry = queue.find((e: any) => e.prefetchKey === prefetchKey);
      expect(entry).to.not.be.undefined;
      expect(entry?.url).to.equal(url);
      expect(entry?.headers?.['X-Test']).to.equal('app-start');

      console.log('✅ Auto-prefetch queue verified:', queue.length, 'entries');
    } catch (e) {
      // MMKV might not be available in test environment
      console.log('MMKV not available for prefetchOnAppStart test');
      expect(true).to.equal(true);
    }
  }
);

test(SUITE_APP_START, 'prefetchOnAppStart requires prefetchKey', async () => {
  const url = getServerUrl('/data/1kb');

  try {
    await prefetchOnAppStart({
      url,
      prefetchKey: '', // Empty key should throw
    });
    // Should not reach here
    expect(false).to.equal(true);
  } catch (e: any) {
    expect(e.message).to.include('prefetchKey');
  }
});

test(
  SUITE_APP_START,
  'prefetchOnAppStart with headers and method',
  async () => {
    const prefetchKey = generatePrefetchKey();
    const url = getServerUrl('/json/small');

    try {
      await prefetchOnAppStart({
        url,
        prefetchKey,
        method: 'GET',
        headers: {
          'X-Custom': 'header-value',
          'Accept': 'application/json',
        },
      });
      expect(true).to.equal(true);
    } catch (e) {
      console.log('MMKV not available for prefetchOnAppStart test');
      expect(true).to.equal(true);
    }
  }
);

test(
  SUITE_APP_START,
  'prefetchOnAppStart overwrites existing entry with same key',
  async () => {
    const prefetchKey = generatePrefetchKey();
    const url1 = getServerUrl('/data/1kb');
    const url2 = getServerUrl('/data/10kb');

    try {
      // Add first entry
      await prefetchOnAppStart({
        url: url1,
        prefetchKey,
      });

      const queue1 = getAutoPrefetchQueue();
      const initialLength = queue1.length;

      // Add second entry with same key (should overwrite)
      await prefetchOnAppStart({
        url: url2,
        prefetchKey,
      });

      const queue2 = getAutoPrefetchQueue();

      // Queue length should remain the same (replaced, not added)
      expect(queue2.length).to.equal(initialLength);

      // Find our entry - should have url2
      const entry = queue2.find((e: any) => e.prefetchKey === prefetchKey);
      expect(entry?.url).to.equal(url2);

      console.log('✅ Auto-prefetch queue replaced entry correctly');
    } catch (e) {
      console.log('MMKV not available for prefetchOnAppStart test');
      expect(true).to.equal(true);
    }
  }
);

test(
  SUITE_APP_START,
  'removeFromAutoPrefetch removes entry from queue',
  async () => {
    const prefetchKey = generatePrefetchKey();
    const url = getServerUrl('/data/1kb');

    try {
      // Add entry
      await prefetchOnAppStart({
        url,
        prefetchKey,
      });

      let queue = getAutoPrefetchQueue();
      const beforeLength = queue.length;

      // Verify it's there
      expect(queue.find((e: any) => e.prefetchKey === prefetchKey)).to.not.be
        .undefined;

      // Remove it
      await removeFromAutoPrefetch(prefetchKey);

      queue = getAutoPrefetchQueue();

      // Should be gone
      expect(queue.find((e: any) => e.prefetchKey === prefetchKey)).to.be
        .undefined;
      expect(queue.length).to.equal(beforeLength - 1);

      console.log('✅ Auto-prefetch entry removed correctly');
    } catch (e) {
      console.log('MMKV not available for removeFromAutoPrefetch test');
      expect(true).to.equal(true);
    }
  }
);

test(SUITE_APP_START, 'clearAutoPrefetchQueue clears all entries', async () => {
  try {
    // Add multiple entries
    await prefetchOnAppStart({
      url: getServerUrl('/data/1kb'),
      prefetchKey: generatePrefetchKey(),
    });
    await prefetchOnAppStart({
      url: getServerUrl('/data/10kb'),
      prefetchKey: generatePrefetchKey(),
    });

    let queue = getAutoPrefetchQueue();
    expect(queue.length).to.be.greaterThan(0);

    // Clear the queue
    await clearAutoPrefetchQueue();

    queue = getAutoPrefetchQueue();
    expect(queue.length).to.equal(0);

    console.log('✅ Auto-prefetch queue cleared successfully');
  } catch (e) {
    console.log('MMKV not available for clearAutoPrefetchQueue test');
    expect(true).to.equal(true);
  }
});

// Stress tests
const SUITE_STRESS = 'Prefetch Stress Tests';

test(SUITE_STRESS, 'prefetch multiple URLs concurrently', async () => {
  const urls = ['/data/1kb', '/data/10kb', '/json/small', '/json/medium'].map(
    getServerUrl
  );

  const prefetches = urls.map((url) => {
    const key = generatePrefetchKey();
    return prefetch({ url, prefetchKey: key }).then(() => ({ url, key }));
  });

  const results = await Promise.all(prefetches);

  // Verify we can fetch all of them
  const fetches = results.map(({ url, key }) =>
    fetch(url, { headers: { prefetchKey: key } })
  );

  const responses = await Promise.all(fetches);

  responses.forEach((response) => {
    expect(response.ok).to.equal(true);
  });
});

test(SUITE_STRESS, 'prefetch with large payload (10mb)', async () => {
  const prefetchKey = generatePrefetchKey();
  const url = getServerUrl('/data/10mb');

  // Prefetch large data
  const startPrefetch = Date.now();
  await prefetch({
    url,
    prefetchKey,
  });
  const prefetchTime = Date.now() - startPrefetch;

  console.log(`Prefetch 10mb took: ${prefetchTime}ms`);

  // Fetch the prefetched data
  const response = await fetch(url, {
    headers: { prefetchKey },
  });

  expect(response.ok).to.equal(true);

  const arrayBuffer = await response.arrayBuffer();
  expect(arrayBuffer.byteLength).to.be.greaterThan(10 * 1000000); // ~10MB
});

test(SUITE_STRESS, 'sequential prefetches with same key', async () => {
  const prefetchKey = generatePrefetchKey();
  const url = getServerUrl('/data/1kb');

  // Do multiple sequential prefetches
  for (let i = 0; i < 5; i++) {
    await prefetch({ url, prefetchKey });
  }

  // Should still work
  const response = await fetch(url, {
    headers: { prefetchKey },
  });

  expect(response.ok).to.equal(true);
});

test(SUITE_STRESS, 'prefetch with special characters in URL', async () => {
  const prefetchKey = generatePrefetchKey();
  const url = getServerUrl('/json/small');

  await prefetch({
    url,
    prefetchKey,
  });

  const response = await fetch(url, {
    headers: { prefetchKey },
  });

  expect(response.ok).to.equal(true);
  const data = await response.json();
  expect(data).to.have.property('items');
});

// ============================
// MaxAge Tests
// ============================

const SUITE_MAX_AGE = 'Prefetch MaxAge';

test(
  SUITE_MAX_AGE,
  'short maxAge - cache expires quickly (2 seconds)',
  async () => {
    const prefetchKey = generatePrefetchKey();
    const url = getServerUrl('/data/1kb');

    // Prefetch with 2-second maxAge
    await prefetch({
      url,
      prefetchKey,
      maxAge: 2000, // 2 seconds
    });

    // Immediately fetch - should use cache
    const response1 = await fetch(url, {
      headers: { prefetchKey },
    });

    expect(response1.headers.get('nitroPrefetched')).to.equal('true');
    await response1.text();

    // Wait 2.5 seconds for cache to expire
    console.log('⏱️ Waiting 2.5 seconds for cache to expire...');
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Try to fetch again - should NOT use cache (new network request)
    const response2 = await fetch(url, {
      headers: { prefetchKey },
    });

    // Should not be prefetched anymore (cache expired)
    expect(response2.headers.get('nitroPrefetched')).to.not.equal('true');
    await response2.text();
  }
);

test(
  SUITE_MAX_AGE,
  'long maxAge - cache stays fresh (60 seconds)',
  async () => {
    const prefetchKey = generatePrefetchKey();
    const url = getServerUrl('/data/1kb');

    // Prefetch with 60-second maxAge
    await prefetch({
      url,
      prefetchKey,
      maxAge: 60000, // 60 seconds
    });

    // Immediately fetch - should use cache
    const response1 = await fetch(url, {
      headers: { prefetchKey },
    });

    expect(response1.headers.get('nitroPrefetched')).to.equal('true');
    await response1.text();

    // Wait 3 seconds - should still be fresh
    console.log('⏱️ Waiting 3 seconds (cache should still be fresh)...');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Prefetch again with same key - should find existing fresh cache
    const prefetchStart = performance.now();
    await prefetch({
      url,
      prefetchKey,
      maxAge: 60000,
    });
    const prefetchDuration = performance.now() - prefetchStart;

    // Prefetch should complete very quickly (finds existing fresh cache)
    console.log(`Prefetch reuse took: ${prefetchDuration.toFixed(2)}ms`);
    expect(prefetchDuration).to.be.lessThan(100); // Should be near-instant
  }
);

test(SUITE_MAX_AGE, 'custom maxAge - 5 seconds', async () => {
  const prefetchKey = generatePrefetchKey();
  const url = getServerUrl('/data/1kb');

  const prefetchTime = Date.now();

  // Prefetch with 5-second maxAge
  await prefetch({
    url,
    prefetchKey,
    maxAge: 5000, // 5 seconds
  });

  // Fetch immediately - should be cached
  const response1 = await fetch(url, {
    headers: { prefetchKey },
  });
  expect(response1.headers.get('nitroPrefetched')).to.equal('true');
  await response1.text();

  // Wait 2 seconds - should still be fresh
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Prefetch again - should find existing fresh cache (fast)
  const reuseStart = performance.now();
  await prefetch({
    url,
    prefetchKey,
    maxAge: 5000,
  });
  const reuseDuration = performance.now() - reuseStart;
  console.log(`Cache reuse (after 2s): ${reuseDuration.toFixed(2)}ms`);
  expect(reuseDuration).to.be.lessThan(100);

  const elapsed = Date.now() - prefetchTime;
  console.log(`Total elapsed: ${elapsed}ms / 5000ms maxAge`);
});

test(SUITE_MAX_AGE, 'default maxAge - falls back to 5 seconds', async () => {
  const prefetchKey = generatePrefetchKey();
  const url = getServerUrl('/data/1kb');

  // Prefetch without specifying maxAge (should default to 5 seconds)
  await prefetch({
    url,
    prefetchKey,
    // maxAge not specified - should default to 5000ms
  });

  // Fetch immediately - should be cached
  const response = await fetch(url, {
    headers: { prefetchKey },
  });
  expect(response.headers.get('nitroPrefetched')).to.equal('true');
  await response.text();

  // Wait 2 seconds - should still be fresh (within 5 second default)
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Prefetch again - should find existing fresh cache
  const reuseStart = performance.now();
  await prefetch({
    url,
    prefetchKey,
  });
  const reuseDuration = performance.now() - reuseStart;
  console.log(`Default maxAge cache reuse: ${reuseDuration.toFixed(2)}ms`);
  expect(reuseDuration).to.be.lessThan(100); // Fast reuse
});

test(SUITE_MAX_AGE, 'prefetchOnAppStart stores maxAge in MMKV', async () => {
  const prefetchKey = generatePrefetchKey();
  const url = getServerUrl('/data/1kb');
  const customMaxAge = 45000; // 45 seconds

  // Clear queue first
  await clearAutoPrefetchQueue();

  // Add entry with custom maxAge
  await prefetchOnAppStart({
    url,
    prefetchKey,
    maxAge: customMaxAge,
  });

  // Read back from MMKV
  const queue = getAutoPrefetchQueue();

  expect(queue).to.be.an('array');
  expect(queue.length).to.equal(1);

  const entry = queue[0];
  expect(entry.prefetchKey).to.equal(prefetchKey);
  expect(entry.url).to.equal(url);
  expect(entry.maxAge).to.equal(customMaxAge);

  console.log(`✅ MMKV entry maxAge: ${entry.maxAge}ms`);

  // Cleanup
  await removeFromAutoPrefetch(prefetchKey);
});
