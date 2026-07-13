export default {
  async fetch(request, env, ctx) {
    // Dynamically handle CORS preflight requests from Chub AI
    if (request.method === "OPTIONS") {
      const requestedHeaders = request.headers.get("Access-Control-Request-Headers") || "*";
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
          "Access-Control-Allow-Headers": requestedHeaders,
          "Access-Control-Max-Age": "86400", // Cache preflight for 24 hours
        },
      });
    }

    const url = new URL(request.url);
    
    // Clean up the URL path to avoid duplicate "/v1/v1" routing errors
    let cleanPath = url.pathname;
    if (cleanPath.startsWith("/v1")) {
      cleanPath = cleanPath.substring(3);
    }
    
    // Route directly to Subaxis's official OpenAI-compatible endpoint
    const targetUrl = "https://subaxis.dev/v1" + cleanPath + url.search;

    const newHeaders = new Headers(request.headers);
    // Delete headers to prevent SSL certificate mismatches and WAF blocks on Subaxis's servers
    newHeaders.delete("host");
    newHeaders.delete("origin");
    newHeaders.delete("referer");
    newHeaders.delete("http-referer");
    newHeaders.delete("x-title");

    // Safely construct request options
    const requestOptions = {
      method: request.method,
      headers: newHeaders,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : null,
      redirect: 'follow'
    };

    try {
      const response = await fetch(targetUrl, requestOptions);
      
      // Clone response headers and append permissive CORS headers so Chub AI can read the response
      const responseHeaders = new Headers(response.headers);
      const requestedHeaders = request.headers.get("Access-Control-Request-Headers") || "*";
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
      responseHeaders.set("Access-Control-Allow-Headers", requestedHeaders);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 
          "Content-Type": "application/json", 
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
          "Access-Control-Allow-Headers": "*",
        }
      });
    }
  }
};
