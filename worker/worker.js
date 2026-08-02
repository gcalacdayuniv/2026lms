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
                
                const existing = await env.DB.prepare(
                    "SELECT User_ID FROM Users WHERE Username COLLATE NOCASE = ? OR Student_Number COLLATE NOCASE = ?"
                ).bind(body.username, body.student_number).first();
                    
                if (existing) {
                    return new Response(JSON.stringify({ error: "Username or Student Number already exists" }), { status: 400, headers: corsHeaders });
                }

                // Process Avatar upload to Google Drive Webhook
                let avatarDriveUrl = null;
                if (body.avatarBase64 && env.GAS_WEBHOOK_URL) {
                    const gasPayload = {
                        filename: `${body.username}_avatar.jpg`,
                        mimeType: "image/jpeg",
                        base64: body.avatarBase64
                    };

                    const gasResponse = await fetch(env.GAS_WEBHOOK_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(gasPayload)
                    });
                    
                    const gasData = await gasResponse.json();
                    if (gasData.success) {
                        avatarDriveUrl = gasData.fileUrl; // Use the Google Drive URL returned from GAS
                    } else {
                        throw new Error("Failed to save avatar image to Drive");
                    }
                }

                const userId = crypto.randomUUID();
                const hashedPassword = await hashPassword(body.password);

                await env.DB.prepare(
                    `INSERT INTO Users (User_ID, Username, Password, Name, Avatar, Email, Contact_Number, Student_Number, account_status, course, year, section, role) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    userId,
                    body.username,
                    hashedPassword,
                    body.name,
                    avatarDriveUrl,
                    body.email,
                    body.contact_number,
                    body.student_number,
                    'Inactive',
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
                const id = body.identifier;

                const user = await env.DB.prepare(
                    `SELECT User_ID, Username, Name, Avatar, Email, Contact_Number, Student_Number, account_status, role, course, year, section 
                     FROM Users 
                     WHERE (Username COLLATE NOCASE = ? OR Email COLLATE NOCASE = ? OR Contact_Number = ? OR Student_Number COLLATE NOCASE = ?) 
                     AND Password = ?`
                ).bind(id, id, id, id, hashedPassword).first();

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
