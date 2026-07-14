const express = require('express');

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
app.all('/*', async (req, res) => {
    const url = new URL(req.url, 'https://integrate.api.nvidia.com');
    let cleanPath = req.path;
    if (cleanPath.startsWith("/v1")) {
        cleanPath = cleanPath.substring(3);
    }
    
    const targetUrl = "https://integrate.api.nvidia.com/v1" + cleanPath + url.search;

    // Clone headers, omitting the Host header to avoid SSL certificate errors
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
        if (key.toLowerCase() !== 'host') {
            headers[key] = value;
        }
    }

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

    try {
        const fetchOptions = {
            method: req.method,
            headers: headers
        };

        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
            // Note: We are NO LONGER overriding the thinking parameters here.
            // Your model's deep-thinking mode remains fully enabled!
            fetchOptions.body = JSON.stringify(req.body);
        }

        const response = await fetch(targetUrl, fetchOptions);

        // Clear the heartbeats as soon as Nvidia begins responding
        if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
        }

        // Forward status and non-encoding headers
        res.status(response.status);
        for (const [key, value] of response.headers.entries()) {
            if (key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'content-encoding') {
                res.setHeader(key, value);
            }
        }

        // Stream the response back chunk-by-chunk
        for await (const chunk of response.body) {
            res.write(chunk);
        }

        res.end();
    } catch (error) {
        if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
        }
        console.error('Proxy Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        } else {
            res.end();
        }
    }
});

app.listen(PORT, () => {
    console.log(`Nvidia Render Proxy with Heartbeats running on port ${PORT}`);
});
