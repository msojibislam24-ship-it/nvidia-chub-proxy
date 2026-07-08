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

// Helper function to read the raw request stream as a string with no size limits
const getRawBody = (req) => {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => {
            data += chunk;
            // Safeguard to prevent memory issues (50MB limit)
            if (data.length > 50 * 1024 * 1024) {
                reject(new Error("Request body too large"));
            }
        });
        req.on('end', () => {
            resolve(data);
        });
        req.on('error', err => {
            reject(err);
        });
    });
};

// Main POST handler (auto-detects streaming or non-streaming to apply the correct keep-alive)
app.post('/*', async (req, res) => {
    let cleanPath = req.path;
    if (cleanPath.startsWith("/v1")) {
        cleanPath = cleanPath.substring(3);
    }

    const targetUrl = 'https://integrate.api.nvidia.com/v1' + cleanPath;

    let interval;

    try {
        // Read the raw request body safely as a string
        const bodyText = await getRawBody(req);
        let bodyJson = {};
        
        try {
            bodyJson = JSON.parse(bodyText);
        } catch (e) {
            // Keep bodyJson empty if not valid JSON
        }

        const isStreaming = bodyJson.stream === true;

        if (isStreaming) {
            // ------------------ STREAMING FLOW ------------------
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // Send standard SSE keep-alive comments to bypass timeout
            res.write(': keepalive\n\n');
            interval = setInterval(() => {
                if (!res.writableEnded) {
                    res.write(': keepalive\n\n');
                }
            }, 15000);

            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Authorization': req.headers['authorization'],
                    'Content-Type': 'application/json'
                },
                body: bodyText
            });

            clearInterval(interval);

            if (!response.ok) {
                const errorText = await response.text();
                res.write(`data: ${JSON.stringify({ error: errorText })}\n\n`);
                return res.end();
            }

            // Pipe Nvidia's stream directly
            for await (const chunk of response.body) {
                res.write(chunk);
            }
            res.end();

        } else {
            // ------------------ NON-STREAMING FLOW ------------------
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // Write a blank space immediately and every 15s to keep the gateway alive
            // Leading whitespace is completely ignored by browser JSON parsers!
            res.write(' ');
            interval = setInterval(() => {
                if (!res.writableEnded) {
                    res.write(' ');
                }
            }, 15000);

            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Authorization': req.headers['authorization'],
                    'Content-Type': 'application/json'
                },
                body: bodyText
            });

            clearInterval(interval);

            if (!response.ok) {
                const errorText = await response.text();
                res.write(errorText);
                return res.end();
            }

            const responseText = await response.text();
            res.write(responseText);
            res.end();
        }

    } catch (err) {
        if (interval) clearInterval(interval);
        console.error('Proxy error:', err);
        if (!res.writableEnded) {
            res.write(JSON.stringify({ error: err.message }));
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
