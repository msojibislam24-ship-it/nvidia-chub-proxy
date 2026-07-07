const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Safely parse incoming request bodies as raw text to avoid any stream hangs
app.use(express.text({ type: '*/*', limit: '50mb' }));

// DIAGNOSTIC ENDPOINT (Kept for testing)
app.get('/test-nvidia', async (req, res) => {
    try {
        const testRes = await fetch("https://integrate.api.nvidia.com/v1/models", {
            method: "GET",
            headers: { "Authorization": "Bearer test-key" }
        });
        res.json({ connection: "Success", status: testRes.status });
    } catch (err) {
        res.status(500).json({ connection: "Failed", error: err.message });
    }
});

// Log incoming requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Incoming ${req.method} request to: ${req.url}`);
    next();
});

// Native stream-based forwarder
app.all('*', async (req, res) => {
    // Strip /v1 if present in the incoming URL to match Nvidia's endpoints
    let cleanPath = req.path;
    if (cleanPath.startsWith("/v1")) {
        cleanPath = cleanPath.substring(3);
    }

    const queryParams = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    const targetUrl = `https://integrate.api.nvidia.com/v1${cleanPath}${queryParams}`;
    
    console.log(`-> Forwarding to Nvidia: ${targetUrl}`);

    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers['content-length']; // Let fetch recalculate size automatically

    const fetchOptions = {
        method: req.method,
        headers: headers,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
        fetchOptions.body = req.body;
    }

    try {
        const nvidiaRes = await fetch(targetUrl, fetchOptions);
        console.log(`[NVIDIA RESPONSE] Status Code: ${nvidiaRes.status}`);

        // Set permissive CORS headers on response
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', '*');

        // Forward all headers from Nvidia except CORS/Encoding headers
        nvidiaRes.headers.forEach((value, key) => {
            if (!key.toLowerCase().startsWith('access-control-') && key.toLowerCase() !== 'transfer-encoding') {
                res.setHeader(key, value);
            }
        });

        res.status(nvidiaRes.status);

        // Stream response back to Chub AI chunk-by-chunk
        const reader = nvidiaRes.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
        }
        res.end();

    } catch (err) {
        console.error('[PROXY ERROR]:', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Nvidia Proxy running on port ${PORT}`);
});
