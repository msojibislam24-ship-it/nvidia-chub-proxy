export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
      "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "*",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    let pathname = url.pathname;

    if (pathname === "/v1") pathname = "";
    else if (pathname.startsWith("/v1/")) pathname = pathname.slice(3);

    const targetUrl = `https://subaxis.dev/v1${pathname}${url.search}`;

    const headers = new Headers();
    const incomingAuth = request.headers.get("Authorization");
    const incomingContentType = request.headers.get("Content-Type");
    const incomingAccept = request.headers.get("Accept");

    if (incomingAuth) headers.set("Authorization", incomingAuth);
    if (incomingContentType) headers.set("Content-Type", incomingContentType);
    headers.set("Accept", incomingAccept || "application/json");

    let body = null;
    let parsedBody = null;

    if (request.method !== "GET" && request.method !== "HEAD") {
      const text = await request.text();

      if (text && incomingContentType && incomingContentType.includes("application/json")) {
        try {
          const data = JSON.parse(text);
          parsedBody = data;

          // Remove fields that often break compatibility on OpenAI-like proxies
          const disallowed = [
            "seed",
            "top_k",
            "top_p",
            "min_p",
            "repetition_penalty",
            "presence_penalty",
            "frequency_penalty",
            "response_format",
            "tools",
            "tool_choice",
            "parallel_tool_calls",
            "logit_bias",
            "metadata",
          ];

          for (const key of disallowed) {
            delete data[key];
          }

          // Make sure model exists; keep Chub's selection if provided
          if (!data.model) data.model = "glm-5.2";

          // Some clients send null messages or weird system wrappers
          if (!Array.isArray(data.messages)) {
            return new Response(JSON.stringify({
              error: "Invalid request: messages must be an array"
            }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          body = JSON.stringify(data);
        } catch {
          body = text;
        }
      } else {
        body = text;
      }
    }

    const upstreamHeaders = new Headers(headers);

    // Remove browser-only headers that can confuse upstream/proxy behavior
    [
      "host",
      "origin",
      "referer",
      "sec-fetch-site",
      "sec-fetch-mode",
      "sec-fetch-dest",
      "sec-fetch-user",
      "sec-ch-ua",
      "sec-ch-ua-mobile",
      "sec-ch-ua-platform",
      "x-title",
      "http-referer",
    ].forEach((h) => upstreamHeaders.delete(h));

    try {
      console.log("========== CHUB REQUEST ==========");

if (parsedBody) {
  console.log(JSON.stringify({
    model: parsedBody.model,
    stream: parsedBody.stream,
    temperature: parsedBody.temperature,
    max_tokens: parsedBody.max_tokens,
    messageCount: parsedBody.messages?.length,
    firstRole: parsedBody.messages?.[0]?.role,
    lastRole: parsedBody.messages?.[parsedBody.messages.length - 1]?.role,
    keys: Object.keys(parsedBody)
  }, null, 2));
}

console.log("===============================");
      const upstreamResponse = await fetch(targetUrl, {
        method: request.method,
        headers: upstreamHeaders,
        body: request.method !== "GET" && request.method !== "HEAD" ? body : null,
      });
      
      const responseText = await upstreamResponse.clone().text();

console.log("========== SUBAXIS ==========");
console.log("STATUS:", upstreamResponse.status);
console.log("URL:", targetUrl);
console.log("BODY:", responseText);
console.log("=============================");

      const responseHeaders = new Headers(upstreamResponse.headers);
      for (const [k, v] of Object.entries(corsHeaders)) {
        responseHeaders.set(k, v);
      }

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({
        error: String(err?.message || err),
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }
  }
};
