import { describe, expect, it } from 'react-native-harness';
import superagent from 'superagent';
import { XMLHttpRequest as NitroXMLHttpRequest } from 'react-native-nitro-fetch';
import { BASE } from '../test-utils/server';

// SuperAgent reads the global constructor when it creates each request.
(globalThis as any).XMLHttpRequest = NitroXMLHttpRequest;

describe('NitroXMLHttpRequest - SuperAgent 8.1.2 compatibility', () => {
  it('sends query parameters and headers and parses JSON', async () => {
    const response = await superagent
      .get(`${BASE}/get`)
      .query({ search: 'nitro' })
      .set('X-SuperAgent', 'enabled');

    expect(response.status).toBe(200);
    expect(response.body.args.search).toBe('nitro');
    expect(response.body.headers['X-Superagent']).toBe('enabled');
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('posts and parses a JSON body', async () => {
    const response = await superagent
      .post(`${BASE}/post`)
      .send({ hello: 'discord', count: 2 });

    expect(response.status).toBe(200);
    expect(response.body.json.hello).toBe('discord');
    expect(response.body.json.count).toBe(2);
  });

  it('allows HTTPUtils-style custom status handling', async () => {
    const response = await superagent
      .get(`${BASE}/status/429`)
      .ok((result) => result.status != null);

    expect(response.status).toBe(429);
  });

  it('returns Blob responses for binary requests', async () => {
    const response = await superagent
      .get(`${BASE}/image/png`)
      .responseType('blob');

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Blob);
    expect(response.body.size).toBeGreaterThan(0);
    expect(response.body.type).toBe('image/png');
  });

  it('uploads SuperAgent fields and React Native file attachments', async () => {
    const attachment = {
      uri: `${BASE}/image/jpeg`,
      name: 'test.jpg',
      type: 'image/jpeg',
    };
    const response = await superagent
      .post(`${BASE}/post`)
      .field('message', 'hello')
      .attach('file', attachment as any, 'test.jpg');

    expect(response.status).toBe(200);
    expect(response.body.form.message).toBe('hello');
    expect(response.body.files.file).toContain('data:image/jpeg;base64,');
  });

  it('reports streaming download progress', async () => {
    const loaded: number[] = [];
    const response = await superagent
      .get(`${BASE}/drip?duration=0.15&numbytes=3`)
      .on('progress', (event) => {
        if ((event as any).direction === 'download') {
          loaded.push(event.loaded);
        }
      });

    expect(response.status).toBe(200);
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded[loaded.length - 1]).toBe(3);
  });

  it('clears SuperAgent response timeout when headers arrive', async () => {
    const response = await superagent
      .get(`${BASE}/drip?duration=0.2&numbytes=2`)
      .timeout({ response: 100, deadline: 1000 });

    expect(response.status).toBe(200);
  });

  it('aborts Nitro when the SuperAgent deadline expires', async () => {
    let error: any;
    try {
      await superagent.get(`${BASE}/delay/2`).timeout({ deadline: 50 });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(error.code).toBe('ECONNABORTED');
  });
});
