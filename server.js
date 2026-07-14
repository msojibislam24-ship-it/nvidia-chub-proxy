const express = require('express');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Custom CORS middleware to support custom headers like http-referer and x-title
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

// Parse JSON bodies so we can inspect and modify them
app.use(express.json());

// Main handler for all API requests
app.all('/*', (req, res) => {
    let cleanPath = req.path;
    if (cleanPath.startsWith("/v1")) {
        cleanPath = cleanPath.substring(3);
    }

    const options = {
        hostname: 'integrate.api.nvidia.com',
        port: 443,
        path: '/v1' + cleanPath + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''),
        method: req.method,
        headers: { ...req.headers }
    };

    // Clean up headers to prevent SSL certificate mismatches
    delete options.headers['host'];
    delete options.headers['content-length']; // let Node recalculate it for the stringified body

    let keepAliveInterval = null;

    // Only start heartbeats on POST requests (actual message generations)
    if (req.method === 'POST') {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Send a silent SSE comment every 20 seconds to keep the Cloudflare connection active
        keepAliveInterval = setInterval(() => {
            if (!res.writableEnded) {
                res.write(': keepalive\n\n');
            }
        }, 20000);
    }

    const proxyReq = https.request(options, (proxyRes) => {
        // Clear the heartbeats as soon as Nvidia begins responding
        if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
        }

        // Forward status and non-encoding headers
        res.status(proxyRes.statusCode);
        for (const [key, value] of Object.entries(proxyRes.headers)) {
            if (key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'content-encoding') {
                res.setHeader(key, value);
            }
        }

        // Stream the response directly back to the client
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (error) => {
        if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
        }
        console.error('Proxy Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        } else {
            res.end();
        }
    });

    // Write the body to the proxy request if applicable
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
        proxyReq.write(JSON.stringify(req.body));
    }

    proxyReq.end();
});

app.listen(PORT, () => {
    console.log(`Nvidia Render Proxy (HTTPS Native) running on port ${PORT}`);
});
