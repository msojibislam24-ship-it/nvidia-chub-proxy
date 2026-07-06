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

// Parse JSON bodies up to 100MB to support massive roleplay chat histories
app.use(express.json({ limit: '100mb' }));

// Main POST handler for chat completions (with built-in keepalive heartbeat)
app.post('/*', async (req, res) => {
    let cleanPath = req.path;
    if (cleanPath.startsWith("/v1")) {
        cleanPath = cleanPath.substring(3);
    }

    const targetUrl = 'https://integrate.api.nvidia.com/v1' + cleanPath;

    // Set up SSE stream headers immediately to prevent Cloudflare/Render 524 timeout
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Instantly send a keep-alive comment so the connection starts active
    res.write(': keepalive\n\n');

    // Send a keep-alive comment every 15 seconds to keep the Cloudflare gate open while Nvidia is thinking
    const interval = setInterval(() => {
        if (!res.writableEnded) {
            res.write(': keepalive\n\n');
        }
    }, 15000);

    try {
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Authorization': req.headers['authorization'],
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(req.body)
        });

        clearInterval(interval);

        if (!response.ok) {
            const errorText = await response.text();
            res.write(`data: ${JSON.stringify({ error: errorText })}\n\n`);
            return res.end();
        }

        // Pipe Nvidia's response chunks directly to the client
        for await (const chunk of response.body) {
            res.write(chunk);
        }
        res.end();
    } catch (err) {
        clearInterval(interval);
        console.error('Proxy error:', err);
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        }
    }
});

// Handle all other requests (like GET /models)
app.get('/*', async (req, res) => {
    let cleanPath = req.path;
    if (cleanPath.startsWith("/v1")) {
        cleanPath = cleanPath.substring(3);
    }
    const targetUrl = 'https://integrate.api.nvidia.com/v1' + cleanPath;

    try {
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'Authorization': req.headers['authorization']
            }
        });
        const data = await response.text();
        res.status(response.status).send(data);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.listen(PORT, () => {
    console.log(`Nvidia Render Proxy running on port ${PORT}`);
});
