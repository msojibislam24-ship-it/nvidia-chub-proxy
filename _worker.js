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

    let isStreaming = false;

    if (request.method !== "GET" && request.method !== "HEAD") {
      try {
        // Clone the request first to read the body safely without disturbing the original stream
        const clonedRequest = request.clone();
        const bodyText = await clonedRequest.text();
        
        if (bodyText) {
          let bodyJson = JSON.parse(bodyText);

          // Force the model to glm-5.2 so Subaxis always accepts it
          bodyJson.model = "glm-5.2";
          isStreaming = bodyJson.stream === true;

          // List of official standard OpenAI Chat Completion parameters
          const allowedKeys = [
            "model", "messages", "temperature", "max_tokens", "stream"
          ];

          // Create an ultra-clean request body keeping ONLY the allowed standard keys
          let cleanBody = {};
          for (const key of allowedKeys) {
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

    let interval;

    try {
      if (isStreaming) {
        // ------------------ STREAMING FLOW ------------------
        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', 'text/event-stream');
        responseHeaders.set('Cache-Control', 'no-cache');
        responseHeaders.set('Connection', 'keep-alive');
        responseHeaders.set("Access-Control-Allow-Origin", "*");
        responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
        responseHeaders.set("Access-Control-Allow-Headers", "*");

        // Send standard SSE keep-alive comments to bypass timeout
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        writer.write(encoder.encode(': keepalive\n\n'));
        interval = setInterval(() => {
          writer.write(encoder.encode(': keepalive\n\n'));
        }, 15000);

        // Fetch using the filtered request body
        fetch(targetUrl, requestOptions).then(async (response) => {
          clearInterval(interval);
          if (!response.ok) {
            const errorText = await response.text();
            writer.write(encoder.encode(`data: ${JSON.stringify({ error: errorText })}\n\n`));
            return writer.close();
          }

          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            writer.write(value);
          }
          writer.close();
        }).catch((err) => {
          clearInterval(interval);
          writer.write(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
          writer.close();
        });

        return new Response(readable, {
          status: 200,
          headers: responseHeaders,
        });

      } else {
        // ------------------ NON-STREAMING FLOW ------------------
        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', 'application/json');
        responseHeaders.set('Cache-Control', 'no-cache');
        responseHeaders.set('Connection', 'keep-alive');
        responseHeaders.set("Access-Control-Allow-Origin", "*");
        responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
        responseHeaders.set("Access-Control-Allow-Headers", "*");

        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // Write a blank space immediately and every 15s to keep the gateway alive
        writer.write(encoder.encode(' '));
        interval = setInterval(() => {
          writer.write(encoder.encode(' '));
        }, 15000);

        // Fetch using the filtered request body
        fetch(targetUrl, requestOptions).then(async (response) => {
          clearInterval(interval);
          if (!response.ok) {
            const errorText = await response.text();
            writer.write(encoder.encode(errorText));
            return writer.close();
          }

          const responseText = await response.text();
          writer.write(encoder.encode(responseText));
          writer.close();
        }).catch((err) => {
          clearInterval(interval);
          writer.write(encoder.encode(JSON.stringify({ error: err.message })));
          writer.close();
        });

        return new Response(readable, {
          status: 200,
          headers: responseHeaders,
        });
      }
    } catch (error) {
      if (interval) clearInterval(interval);
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
