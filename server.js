const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// DIAGNOSTIC TEST ENDPOINT
app.get('/test-nvidia', async (req, res) => {
    console.log("=== DIAGNOSTIC: Testing direct connection to Nvidia ===");
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout limit

        const testRes = await fetch("https://integrate.api.nvidia.com/v1/models", {
            method: "GET",
            headers: {
                "Authorization": "Bearer test-key"
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        console.log(`=== DIAGNOSTIC SUCCESS: Nvidia responded with status ${testRes.status} ===`);
        res.json({ 
            connection: "Success", 
            status: testRes.status, 
            message: "Nvidia's servers are accessible from this Render instance!" 
        });
    } catch (err) {
        console.error("=== DIAGNOSTIC FAILED: connection blocked ===", err);
        res.status(500).json({ 
            connection: "Failed", 
            error: err.message, 
            message: "Nvidia's firewall appears to be blocking this Render server's IP address." 
        });
    }
});

// Log all incoming requests to the proxy
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Incoming ${req.method} request to: ${req.url}`);
    next();
});

// Automatically forward everything to Nvidia
app.use('/', createProxyMiddleware({
    target: 'https://integrate.api.nvidia.com/v1',
    changeOrigin: true,
    pathRewrite: {
        '^/v1': '/', 
    },
    onProxyReq: (proxyReq, req, res) => {
        proxyReq.setHeader('host', 'integrate.api.nvidia.com');
    },
    onProxyRes: (proxyRes, req, res) => {
        console.log(`[NVIDIA RESPONSE] Status Code: ${proxyRes.statusCode}`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', '*');
    },
    onError: (err, req, res) => {
        console.error('[PROXY ERROR]:', err);
        res.status(500).json({ error: err.message });
    }
}));

app.listen(PORT, () => {
    console.log(`Nvidia Proxy running on port ${PORT}`);
});
