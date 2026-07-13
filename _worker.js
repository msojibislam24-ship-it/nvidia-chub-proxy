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

    // Safely construct request options (GET/HEAD requests cannot have a body)
    const requestOptions = {
      method: request.method,
      headers: newHeaders,
      redirect: 'follow'
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      try {
        // Clone the request first to read the body safely without disturbing the original stream
        const clonedRequest = request.clone();
        const bodyText = await clonedRequest.text();
        
        if (bodyText) {
          let bodyJson = JSON.parse(bodyText);

          // Bare minimum standard parameters needed for roleplay to guarantee compatibility
          const essentialKeys = [
            "model", "messages", "temperature", "max_tokens", "stream"
          ];

          // Create an ultra-clean request body keeping ONLY the essential keys
          let cleanBody = {};
          for (const key of essentialKeys) {
            if (bodyJson[key] !== undefined) {
              cleanBody[key] = bodyJson[key];
            }
          }

          requestOptions.body = JSON.stringify(cleanBody);
          newHeaders.delete("content-length"); // Let fetch recalculate size
        } else {
          requestOptions.body = null;
        }
      } catch (e) {
        requestOptions.body = request.body;
      }
    }

    try {
      const modifiedRequest = new Request(targetUrl, requestOptions);
      const response = await fetch(modifiedRequest);
      
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
