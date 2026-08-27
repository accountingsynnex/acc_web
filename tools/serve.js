#!/usr/bin/env node
/* A static server for local development.
 *
 *   npm run serve            http://localhost:8080
 *   npm run serve -- 3000    a different port
 *
 * The app is designed to run from file:// and must keep doing so, but a few
 * things only behave realistically over http://: the browser's cache (so the
 * ?v= build stamp can be seen working), and any future change to ES modules,
 * which file:// blocks outright.
 *
 * Deliberately dependency-free and about sixty lines. Nothing here is used
 * in production — GitHub Pages serves the same files.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.csv': 'text/csv; charset=utf-8',
  '.woff2': 'font/woff2',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

http.createServer((req, res) => {
  // Strip the query — the app appends ?v=<build> to every asset — then
  // resolve inside ROOT and refuse anything that escaped it. A dev server is
  // still a server, and ../../etc/passwd is still a request someone can make.
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err2, body) => {
      if (err2) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found: ' + url);
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        // No caching: the point of running this locally is to see edits.
        'Cache-Control': 'no-store',
      });
      res.end(body);
    });
  });
}).listen(PORT, () => {
  console.log(`FS Close Workspace  ->  http://localhost:${PORT}`);
  console.log(`serving ${ROOT}\nCtrl+C to stop`);
});
