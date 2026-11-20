// worker/http.js
// Small response helper shared by the route files.

// A JSON response with the CORS headers the caller already built.
export const json = (corsHeaders, body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: corsHeaders });
