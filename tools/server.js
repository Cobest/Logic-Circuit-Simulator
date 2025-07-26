#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const port = process.argv[2] || 8088;

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm'
};

const server = http.createServer((req, res) => {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url);
    let pathname = `.${parsedUrl.pathname}`;

    // Default to index.html
    if (pathname === './') {
        pathname = './index.html';
    }

    fs.readFile(pathname, (err, data) => {
        if (err) {
            res.statusCode = 404;
            res.end(`File ${pathname} not found!`);
            return;
        }

        const ext = path.parse(pathname).ext;
        res.setHeader('Content-type', mimeTypes[ext] || 'text/plain');
        res.end(data);
    });
});

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
    console.log(`Logic Circuit Simulator available at: http://localhost:${port}/`);
});
