import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ASSETS = {
  '/': ['web/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['web/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['web/style.css', 'text/css; charset=utf-8'],
  '/scriptable/UsageWidget.js': ['scriptable/UsageWidget.js', 'text/javascript; charset=utf-8'],
  '/scriptable/SetupUsageWidget.js': ['scriptable/SetupUsageWidget.js', 'text/javascript; charset=utf-8'],
};
function authorized(request, token) {
  const actual = Buffer.from(request.headers.authorization || '');
  const expected = Buffer.from('Bearer ' + token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function createServer({ root, token, collector }) {
  return http.createServer(async (request, response) => {
    const headers = {
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'Cache-Control': 'no-store',
    };
    const send = (status, type, body) => {
      response.writeHead(status, { ...headers, 'Content-Type': type });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    try {
      const url = new URL(request.url, 'http://localhost');
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.setHeader('Allow', 'GET, HEAD');
        return send(405, 'application/json', '{"error":"method_not_allowed"}');
      }
      if (url.pathname === '/health') return send(200, 'application/json', '{"ok":true}');
      if (url.pathname === '/api/v1/overview') {
        if (!authorized(request, token)) return send(401, 'application/json', '{"error":"unauthorized"}');
        return send(200, 'application/json', JSON.stringify(collector.overview()));
      }
      const asset = Object.hasOwn(ASSETS, url.pathname) && ASSETS[url.pathname];
      if (!asset) return send(404, 'application/json', '{"error":"not_found"}');
      return send(200, asset[1], await readFile(path.join(root, asset[0])));
    } catch { return send(500, 'application/json', '{"error":"internal_error"}'); }
  });
}
