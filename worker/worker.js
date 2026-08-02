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
            // ==========================================
            // AUTHENTICATION & REGISTRATION ENDPOINTS
            // ==========================================
            if (request.method === "POST" && url.pathname === "/api/register") {
                const body = await request.json();
                
                const studentNoFormat = /^\d{2}-\d{4}$/;
                if (!studentNoFormat.test(body.student_number)) {
                    return new Response(JSON.stringify({ error: "Invalid Student Number. Format must be 00-0000" }), { status: 400, headers: corsHeaders });
                }
                if (studentNoFormat.test(body.username)) {
                    return new Response(JSON.stringify({ error: "Username cannot match the Student Number format (00-0000)" }), { status: 400, headers: corsHeaders });
                }

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
                    finalAvatarUrl = gasData.fileUrl;
                }

                const userId = crypto.randomUUID();
                const hashedPassword = await hashPassword(body.password);

                await env.DB.prepare(
                    `INSERT INTO Users (User_ID, Username, Password, Name, Avatar, Email, Contact_Number, Student_Number, account_status, course, year, section, role) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    userId, body.username, hashedPassword, body.name, finalAvatarUrl, 
                    body.email, body.contact_number, body.student_number, 
                    'Inactive', body.course, body.year, body.section, 'Student'
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

                if (user.account_status.toLowerCase() !== 'active') {
                    return new Response(JSON.stringify({ 
                        error: "Account is pending approval. Please wait for an admin or lecturer to activate your account." 
                    }), { status: 403, headers: corsHeaders });
                }

                return new Response(JSON.stringify({ success: true, user }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && url.pathname === "/api/change-password") {
                const body = await request.json();
                const { userId, currentPassword, newPassword } = body;
                
                const currentHash = await hashPassword(currentPassword);
                const user = await env.DB.prepare("SELECT Password FROM Users WHERE User_ID = ?").bind(userId).first();
                
                if (!user || user.Password !== currentHash) {
                    return new Response(JSON.stringify({ error: "Incorrect current password" }), { status: 400, headers: corsHeaders });
                }
                
                const newHash = await hashPassword(newPassword);
                await env.DB.prepare("UPDATE Users SET Password = ? WHERE User_ID = ?").bind(newHash, userId).run();
                
                return new Response(JSON.stringify({ success: true, message: "Password updated successfully" }), { status: 200, headers: corsHeaders });
            }

            // ==========================================
            // COURSE MANAGEMENT ENDPOINTS
            // ==========================================
            if (request.method === "POST" && url.pathname === "/api/courses") {
                const body = await request.json();
                const courseId = crypto.randomUUID();
                
                const targetCourse = body.targetCourse || "";
                const targetYear = body.targetYear || "";
                const targetSection = body.targetSection || "";
                
                await env.DB.prepare(
                    `INSERT INTO Courses (Course_ID, CourseCode, CourseTitle, ScheduleDay, TimePeriod, Lecturer_ID, Target_Course, Target_Year, Target_Section) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(courseId, body.courseCode, body.courseTitle, body.scheduleDay, body.timePeriod, body.lecturerId, targetCourse, targetYear, targetSection).run();
                
                return new Response(JSON.stringify({ success: true, message: "Course created successfully" }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "GET" && url.pathname === "/api/courses") {
                const studentId = url.searchParams.get("studentId");
                
                let courses;
                
                if (studentId) {
                    // Fetch student context to apply filtering logic
                    const student = await env.DB.prepare("SELECT course, year, section FROM Users WHERE User_ID = ?").bind(studentId).first();
                    
                    if (!student) {
                        return new Response(JSON.stringify({ error: "Student not found" }), { status: 404, headers: corsHeaders });
                    }
                    
                    courses = await env.DB.prepare(
                        `SELECT c.*, u.Name as LecturerName 
                         FROM Courses c 
                         JOIN Users u ON c.Lecturer_ID = u.User_ID
                         WHERE (c.Target_Course IS NULL OR c.Target_Course = '' OR c.Target_Course COLLATE NOCASE = ?)
                           AND (c.Target_Year IS NULL OR c.Target_Year = '' OR c.Target_Year COLLATE NOCASE = ?)
                           AND (c.Target_Section IS NULL OR c.Target_Section = '' OR c.Target_Section COLLATE NOCASE = ?)`
                    ).bind(student.course, student.year, student.section).all();
                } else {
                    courses = await env.DB.prepare(
                        `SELECT c.*, u.Name as LecturerName 
                         FROM Courses c 
                         JOIN Users u ON c.Lecturer_ID = u.User_ID`
                    ).all();
                }
                
                return new Response(JSON.stringify({ success: true, courses: courses.results }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && url.pathname === "/api/enroll") {
                const body = await request.json();
                
                const existing = await env.DB.prepare(
                    `SELECT Enrollment_ID FROM Enrollments WHERE Course_ID = ? AND Student_ID = ?`
                ).bind(body.courseId, body.studentId).first();

                if (existing) {
                     return new Response(JSON.stringify({ error: "You are already enrolled in this course." }), { status: 400, headers: corsHeaders });
                }

                const enrollId = crypto.randomUUID();
                await env.DB.prepare(
                    `INSERT INTO Enrollments (Enrollment_ID, Course_ID, Student_ID) VALUES (?, ?, ?)`
                ).bind(enrollId, body.courseId, body.studentId).run();
                
                return new Response(JSON.stringify({ success: true }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "GET" && url.pathname === "/api/my-courses") {
                const userId = url.searchParams.get("userId");
                const role = url.searchParams.get("role");
                
                if (role === 'lecturer') {
                    const myCourses = await env.DB.prepare(
                        `SELECT * FROM Courses WHERE Lecturer_ID = ?`
                    ).bind(userId).all();
                    return new Response(JSON.stringify({ success: true, courses: myCourses.results }), { status: 200, headers: corsHeaders });
                } else {
                    const enrolled = await env.DB.prepare(
                        `SELECT c.*, u.Name as LecturerName 
                         FROM Enrollments e 
                         JOIN Courses c ON e.Course_ID = c.Course_ID 
                         JOIN Users u ON c.Lecturer_ID = u.User_ID 
                         WHERE e.Student_ID = ?`
                    ).bind(userId).all();
                    return new Response(JSON.stringify({ success: true, courses: enrolled.results }), { status: 200, headers: corsHeaders });
                }
            }

            return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: corsHeaders });

        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
    }
};
