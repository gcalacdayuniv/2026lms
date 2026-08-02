// worker/worker.js
export default {
    async fetch(request, env, ctx) {
        const corsHeaders = {
            "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        try {
            if (request.method === "POST" && path === "/register") {
                const data = await request.json();
                const userId = crypto.randomUUID();
                
                await env.DB.prepare(
                    "INSERT INTO Users (User_ID, Username, Password, Name, Email) VALUES (?, ?, ?, ?, ?)"
                ).bind(userId, data.username, data.password, data.name, data.email).run();

                return new Response(JSON.stringify({ success: true, message: "Registration successful" }), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            if (request.method === "POST" && path === "/login") {
                const data = await request.json();
                const user = await env.DB.prepare(
                    "SELECT * FROM Users WHERE Username = ? AND Password = ?"
                ).bind(data.username, data.password).first();

                if (!user) {
                    return new Response(JSON.stringify({ success: false, message: "Invalid credentials" }), {
                        status: 401,
                        headers: { ...corsHeaders, "Content-Type": "application/json" }
                    });
                }

                delete user.Password;

                return new Response(JSON.stringify({ success: true, user }), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            return new Response(JSON.stringify({ error: "Endpoint not found" }), { 
                status: 404, 
                headers: { ...corsHeaders, "Content-Type": "application/json" } 
            });

        } catch (error) {
            return new Response(JSON.stringify({ success: false, message: error.message }), { 
                status: 500, 
                headers: { ...corsHeaders, "Content-Type": "application/json" } 
            });
        }
    }
};
