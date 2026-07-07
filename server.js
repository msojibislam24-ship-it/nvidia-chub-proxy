const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

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
    console.log(`Nvidia Render Proxy running on port ${PORT}`);
});
