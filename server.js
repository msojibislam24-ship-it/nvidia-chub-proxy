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

    const proxyReq = https.request(options, (proxyRes) => {
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
        console.error('Proxy Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        } else {
            res.end();
        }
    });

    // Write the body to the proxy request if applicable
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
        let bodyJson = req.body;
        
        // Force Nvidia to turn off thinking for GLM-5.2 to speed up generation and avoid timeouts
        if (bodyJson.model && bodyJson.model.includes("glm-5.2")) {
            bodyJson.chat_template_kwargs = { "enable_thinking": false };
        }
        
        proxyReq.write(JSON.stringify(bodyJson));
    }

    proxyReq.end();
});

app.listen(PORT, () => {
    console.log(`Nvidia Render Proxy (No-Thinking Native) running on port ${PORT}`);
});
