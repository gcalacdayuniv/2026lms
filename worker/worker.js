// worker/worker.js
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        const corsHeaders = {
            "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            if (request.method === "POST" && url.pathname === "/api/register") {
                const body = await request.json();
                
                // Check if user exists
                const existing = await env.DB.prepare("SELECT User_ID FROM Users WHERE Username = ?")
                    .bind(body.username)
                    .first();
                    
                if (existing) {
                    return new Response(JSON.stringify({ error: "Username already exists" }), { status: 400, headers: corsHeaders });
                }

                const userId = crypto.randomUUID();
                const hashedPassword = await hashPassword(body.password);

                await env.DB.prepare(
                    `INSERT INTO Users (User_ID, Username, Password, Name, Email, Contact_Number, course, year, section, role) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    userId,
                    body.username,
                    hashedPassword,
                    body.name,
                    body.email,
                    body.contact_number,
                    body.course,
                    body.year,
                    body.section,
                    'user'
                ).run();

                return new Response(JSON.stringify({ success: true, message: "User registered" }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "POST" && url.pathname === "/api/login") {
                const body = await request.json();
                const hashedPassword = await hashPassword(body.password);

                const user = await env.DB.prepare(
                    `SELECT User_ID, Username, Name, Avatar, Email, Contact_Number, role, course, year, section 
                     FROM Users 
                     WHERE Username = ? AND Password = ?`
                ).bind(body.username, hashedPassword).first();

                if (!user) {
                    return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401, headers: corsHeaders });
                }

                return new Response(JSON.stringify({ success: true, user }), { status: 200, headers: corsHeaders });
            }

            return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: corsHeaders });

        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
    }
};
