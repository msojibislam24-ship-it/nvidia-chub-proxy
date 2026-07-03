const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Automatically forward everything to Nvidia
app.use('/', createProxyMiddleware({
    target: 'https://integrate.api.nvidia.com/v1',
    changeOrigin: true,
    pathRewrite: {
        '^/v1': '/', // handle both /v1 and raw endpoints
    },
    onProxyReq: (proxyReq, req, res) => {
        proxyReq.setHeader('host', 'integrate.api.nvidia.com');
    },
    onProxyRes: (proxyRes, req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', '*');
    },
    onError: (err, req, res) => {
        console.error('Proxy Error:', err);
        res.status(500).json({ error: err.message });
    }
}));

app.listen(PORT, () => {
    console.log(`Nvidia Render Proxy running on port ${PORT}`);
});
