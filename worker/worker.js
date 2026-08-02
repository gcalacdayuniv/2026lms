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
                
                // Format Validations
                const studentNoFormat = /^\d{2}-\d{4}$/;
                
                if (!studentNoFormat.test(body.student_number)) {
                    return new Response(JSON.stringify({ error: "Invalid Student Number. Format must be 00-0000" }), { status: 400, headers: corsHeaders });
                }

                if (studentNoFormat.test(body.username)) {
                    return new Response(JSON.stringify({ error: "Username cannot match the Student Number format (00-0000)" }), { status: 400, headers: corsHeaders });
                }

                // Check Uniqueness
                const existing = await env.DB.prepare(
                    `SELECT User_ID FROM Users 
                     WHERE Username COLLATE NOCASE = ? 
                     OR Student_Number COLLATE NOCASE = ? 
                     OR Email COLLATE NOCASE = ? 
                     OR Contact_Number = ?`
                ).bind(body.username, body.student_number, body.email, body.contact_number).first();
                    
                if (existing) {
                    return new Response(JSON.stringify({ error: "Username, Student Number, Email, or Contact Number is already registered." }), { status: 400, headers: corsHeaders });
                }

                // Process Avatar Upload to Google Drive
                let finalAvatarUrl = null;

                if (body.avatarBase64) {
                    if (!env.GAS_WEBHOOK_URL) {
                        return new Response(JSON.stringify({ error: "Server Configuration Error: GAS_WEBHOOK_URL is missing. Please redeploy the Cloudflare Worker." }), { status: 500, headers: corsHeaders });
                    }

                    const courseVal = body.course ? body.course.trim() : "";
                    const yearVal = body.year ? body.year.trim() : "";
                    const sectionVal = body.section ? body.section.trim() : "";
                    const courseYearSection = [courseVal, yearVal, sectionVal].filter(Boolean).join(" ") || "General";
                    
                    const formattedFilename = `${body.student_number}_${body.name}.jpg`;

                    const gasPayload = {
                        filename: formattedFilename,
                        mimeType: "image/jpeg",
                        base64: body.avatarBase64,
                        pathParts: [courseYearSection, "Profile Picture"]
                    };

                    const gasResponse = await fetch(env.GAS_WEBHOOK_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(gasPayload),
                        redirect: 'follow'
                    });
                    
                    const gasText = await gasResponse.text();
                    let gasData;
                    try {
                        gasData = JSON.parse(gasText);
                    } catch (parseError) {
                        return new Response(JSON.stringify({ error: "Google Apps Script blocked the upload. Ensure it is deployed as 'Execute as: Me' and 'Access: Anyone'." }), { status: 500, headers: corsHeaders });
                    }

                    if (!gasData.success) {
                        return new Response(JSON.stringify({ error: "Google Drive Error: " + gasData.error }), { status: 500, headers: corsHeaders });
                    }

                    // Store the Google Drive URL instead of Base64 to save D1 storage space
                    finalAvatarUrl = gasData.fileUrl;
                }

                // Insert User
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
                    finalAvatarUrl, // Using the Google Drive link
                    body.email,
                    body.contact_number,
                    body.student_number,
                    'Inactive', // Default status
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

                // Account Activation Check (Case-Insensitive)
                if (user.account_status.toLowerCase() !== 'active') {
                    return new Response(JSON.stringify({ 
                        error: "Account is pending approval. Please wait for an admin or lecturer to activate your account." 
                    }), { status: 403, headers: corsHeaders });
                }

                return new Response(JSON.stringify({ success: true, user }), { status: 200, headers: corsHeaders });
            }

            return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: corsHeaders });

        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
    }
};
