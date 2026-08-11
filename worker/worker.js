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
        const path = url.pathname.replace(/\/$/, ''); 
        const requestOrigin = request.headers.get("Origin");
        
        let allowedOrigin = env.ALLOWED_ORIGIN || "*";
        if (requestOrigin === "https://plv.workers.dev" || requestOrigin === "https://www.plv.workers.dev") {
            allowedOrigin = requestOrigin;
        }
        
        const corsHeaders = {
            "Access-Control-Allow-Origin": allowedOrigin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
            "Access-Control-Allow-Headers": "Content-Type"
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            if (request.method === "POST" && path === "/api/upload-submission") {
                const body = await request.json();
                
                if (!env.GAS_WEBHOOK_URL) {
                    return new Response(JSON.stringify({ error: "Server Configuration Error: GAS_WEBHOOK_URL is missing." }), { status: 500, headers: corsHeaders });
                }

                let gasResponse = await fetch(env.GAS_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify(body),
                    redirect: 'manual'
                });

                if (gasResponse.status === 302 || gasResponse.status === 303) {
                    const redirectUrl = gasResponse.headers.get('Location');
                    gasResponse = await fetch(redirectUrl);
                }
                
                const gasText = await gasResponse.text();
                let gasData;
                try {
                    gasData = JSON.parse(gasText);
                } catch (parseError) {
                    return new Response(JSON.stringify({ 
                        error: `Google created the file, but intercepted the JSON response. Raw Google Output: ${gasText.substring(0, 150)}...` 
                    }), { status: 500, headers: corsHeaders });
                }

                if (!gasData.success) {
                    return new Response(JSON.stringify({ error: "Google Drive Error: " + gasData.error }), { status: 500, headers: corsHeaders });
                }

                const subId = crypto.randomUUID();
                await env.DB.prepare(
                    `INSERT INTO Submissions (Submission_ID, Course_ID, Student_ID, Term, Title, Description, Type, File_URL, Timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
                ).bind(subId, body.courseId, body.studentId, body.term, body.title, body.description, body.type, gasData.fileUrl).run();

                return new Response(JSON.stringify({ success: true, fileUrl: gasData.fileUrl }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/register") {
                const body = await request.json();
                
                const studentNoFormat = /^\d{2}-\d{4}$/;
                if (!studentNoFormat.test(body.student_number)) {
                    return new Response(JSON.stringify({ error: "Invalid Student Number. Format must be 00-0000" }), { status: 400, headers: corsHeaders });
                }
                if (studentNoFormat.test(body.username)) {
                    return new Response(JSON.stringify({ error: "Username cannot match the Student Number format (00-0000)" }), { status: 400, headers: corsHeaders });
                }

                const existing = await env.DB.prepare(
                    `SELECT Username, Student_Number, Email, Contact_Number FROM Users 
                     WHERE Username COLLATE NOCASE = ? 
                     OR Student_Number COLLATE NOCASE = ? 
                     OR Email COLLATE NOCASE = ? 
                     OR Contact_Number = ?`
                ).bind(body.username, body.student_number, body.email, body.contact_number).first();
                    
                if (existing) {
                    const conflicts = [];
                    if (existing.Username && body.username && existing.Username.toLowerCase() === body.username.toLowerCase()) conflicts.push("Username");
                    if (existing.Student_Number && body.student_number && existing.Student_Number.toLowerCase() === body.student_number.toLowerCase()) conflicts.push("Student Number");
                    if (existing.Email && body.email && existing.Email.toLowerCase() === body.email.toLowerCase()) conflicts.push("Email");
                    if (existing.Contact_Number && body.contact_number && existing.Contact_Number === body.contact_number) conflicts.push("Contact Number");
                    
                    return new Response(JSON.stringify({ error: `The following is already registered to another account: ${conflicts.join(', ')}.` }), { status: 400, headers: corsHeaders });
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

                    let gasResponse = await fetch(env.GAS_WEBHOOK_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain' },
                        body: JSON.stringify(gasPayload),
                        redirect: 'manual'
                    });

                    if (gasResponse.status === 302 || gasResponse.status === 303) {
                        const redirectUrl = gasResponse.headers.get('Location');
                        gasResponse = await fetch(redirectUrl);
                    }
                    
                    const gasText = await gasResponse.text();
                    let gasData;
                    try {
                        gasData = JSON.parse(gasText);
                    } catch (parseError) {
                        return new Response(JSON.stringify({ 
                            error: `Google created the file, but intercepted the JSON response. Raw Google Output: ${gasText.substring(0, 150)}...` 
                        }), { status: 500, headers: corsHeaders });
                    }

                    if (!gasData.success) {
                        return new Response(JSON.stringify({ error: "Google Drive Error: " + gasData.error }), { status: 500, headers: corsHeaders });
                    }
                    finalAvatarUrl = gasData.fileUrl;
                }

                const userId = crypto.randomUUID();
                const hashedPassword = await hashPassword(body.password);

                await env.DB.prepare(
                    `INSERT INTO Users (User_ID, Username, Password, Name, Avatar, Email, Contact_Number, Student_Number, account_status, course, year, section, eye_condition, role, registration_timestamp) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
                ).bind(
                    userId, body.username, hashedPassword, body.name, finalAvatarUrl, 
                    body.email, body.contact_number, body.student_number, 
                    'Inactive', body.course ? body.course.trim() : null, body.year ? body.year.trim() : null, body.section ? body.section.trim() : null, body.eye_condition ? body.eye_condition.trim() : null, 'Student'
                ).run();

                return new Response(JSON.stringify({ success: true, message: "User registered" }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/login") {
                const body = await request.json();
                const hashedPassword = await hashPassword(body.password);
                const id = body.identifier;

                const user = await env.DB.prepare(
                    `SELECT User_ID, Username, Name, Avatar, Email, Contact_Number, Student_Number, account_status, role, course, year, section, eye_condition 
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

            if (request.method === "POST" && path === "/api/change-password") {
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
            
            if (request.method === "POST" && path === "/api/update-details") {
                const body = await request.json();
                const { userId, password, name, username, email, contact, studentNumber } = body;
                
                const studentNoFormat = /^\d{2}-\d{4}$/;
                if (!studentNoFormat.test(studentNumber)) {
                    return new Response(JSON.stringify({ error: "Invalid Student Number. Format must be 00-0000" }), { status: 400, headers: corsHeaders });
                }
                
                const currentHash = await hashPassword(password);
                const user = await env.DB.prepare("SELECT Password FROM Users WHERE User_ID = ?").bind(userId).first();
                
                if (!user || user.Password !== currentHash) {
                    return new Response(JSON.stringify({ error: "Incorrect password" }), { status: 400, headers: corsHeaders });
                }

                const existing = await env.DB.prepare(
                    `SELECT Username, Student_Number, Email, Contact_Number FROM Users 
                     WHERE (Username COLLATE NOCASE = ? 
                     OR Student_Number COLLATE NOCASE = ? 
                     OR Email COLLATE NOCASE = ? 
                     OR Contact_Number = ?)
                     AND User_ID != ?`
                ).bind(username, studentNumber, email, contact, userId).first();
                    
                if (existing) {
                    const conflicts = [];
                    if (existing.Username && username && existing.Username.toLowerCase() === username.toLowerCase()) conflicts.push("Username");
                    if (existing.Student_Number && studentNumber && existing.Student_Number.toLowerCase() === studentNumber.toLowerCase()) conflicts.push("Student Number");
                    if (existing.Email && email && existing.Email.toLowerCase() === email.toLowerCase()) conflicts.push("Email");
                    if (existing.Contact_Number && contact && existing.Contact_Number === contact) conflicts.push("Contact Number");
                    
                    return new Response(JSON.stringify({ error: `The following information is already taken by another account: ${conflicts.join(', ')}.` }), { status: 400, headers: corsHeaders });
                }

                await env.DB.prepare(
                    `UPDATE Users SET Name = ?, Username = ?, Email = ?, Contact_Number = ?, Student_Number = ? WHERE User_ID = ?`
                ).bind(name, username, email, contact, studentNumber, userId).run();
                
                return new Response(JSON.stringify({ success: true, message: "Details updated successfully" }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/reset-student-password") {
                const body = await request.json();
                const { studentId } = body;
                
                if (!studentId) {
                    return new Response(JSON.stringify({ error: "Missing studentId" }), { status: 400, headers: corsHeaders });
                }
                
                const newHash = await hashPassword("123456");
                await env.DB.prepare("UPDATE Users SET Password = ? WHERE User_ID = ?").bind(newHash, studentId).run();
                
                return new Response(JSON.stringify({ success: true, message: "Password reset successfully" }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/users") {
                const users = await env.DB.prepare(
                    `SELECT User_ID, Username, Name, Avatar, Email, Contact_Number, Student_Number, account_status, course, year, section, role, registration_timestamp 
                     FROM Users ORDER BY Name ASC`
                ).all();
                return new Response(JSON.stringify({ success: true, users: users.results }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/update-user-status") {
                const body = await request.json();
                if (!body.studentId || !body.status) {
                    return new Response(JSON.stringify({ error: "Missing required parameters." }), { status: 400, headers: corsHeaders });
                }
                await env.DB.prepare(
                    `UPDATE Users SET account_status = ? WHERE User_ID = ?`
                ).bind(body.status, body.studentId).run();
                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/programs") {
                const body = await request.json();
                const code = body.programCode ? body.programCode.trim().toUpperCase() : "";
                
                if (!code) {
                    return new Response(JSON.stringify({ error: "Program code is required" }), { status: 400, headers: corsHeaders });
                }
                
                const existing = await env.DB.prepare("SELECT Program_ID FROM Programs WHERE ProgramCode = ?").bind(code).first();
                if (existing) {
                    return new Response(JSON.stringify({ error: "Course (Program) already exists in the list." }), { status: 400, headers: corsHeaders });
                }
                
                const id = crypto.randomUUID();
                await env.DB.prepare("INSERT INTO Programs (Program_ID, ProgramCode) VALUES (?, ?)").bind(id, code).run();
                
                return new Response(JSON.stringify({ success: true }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/programs") {
                try {
                    const programs = await env.DB.prepare("SELECT * FROM Programs ORDER BY ProgramCode ASC").all();
                    return new Response(JSON.stringify({ success: true, programs: programs.results }), { status: 200, headers: corsHeaders });
                } catch (err) {
                    return new Response(JSON.stringify({ success: true, programs: [] }), { status: 200, headers: corsHeaders });
                }
            }

            if (request.method === "POST" && path === "/api/courses") {
                const body = await request.json();
                const courseId = crypto.randomUUID();
                
                const targetCourse = body.targetCourse ? body.targetCourse.trim() : "";
                const targetYear = body.targetYear ? body.targetYear.trim() : "";
                const targetSection = body.targetSection ? body.targetSection.trim() : "";
                
                await env.DB.prepare(
                    `INSERT INTO Courses (Course_ID, CourseCode, CourseTitle, ScheduleDay, TimePeriod, Lecturer_ID, Target_Course, Target_Year, Target_Section) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(courseId, body.courseCode, body.courseTitle, body.scheduleDay, body.timePeriod, body.lecturerId, targetCourse, targetYear, targetSection).run();
                
                return new Response(JSON.stringify({ success: true, message: "Course created successfully" }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/update-course-terms") {
                const body = await request.json();
                
                await env.DB.prepare(
                    `UPDATE Courses SET Midterm_Start = ?, Midterm_End = ?, Final_Start = ?, Final_End = ? WHERE Course_ID = ?`
                ).bind(
                    body.midtermStart || null, 
                    body.midtermEnd || null, 
                    body.finalStart || null, 
                    body.finalEnd || null, 
                    body.courseId
                ).run();
                
                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/courses") {
                const studentId = url.searchParams.get("studentId");
                
                let courses;
                
                if (studentId) {
                    const student = await env.DB.prepare("SELECT course, year, section FROM Users WHERE User_ID = ?").bind(studentId).first();
                    
                    if (!student) {
                        return new Response(JSON.stringify({ error: "Student not found" }), { status: 404, headers: corsHeaders });
                    }
                    
                    const sCourse = student.course ? student.course.trim() : "";
                    const sYear = student.year ? student.year.trim() : "";
                    const sSection = student.section ? student.section.trim() : "";
                    
                    courses = await env.DB.prepare(
                        `SELECT c.*, u.Name as LecturerName 
                         FROM Courses c 
                         JOIN Users u ON c.Lecturer_ID = u.User_ID
                         WHERE (c.Target_Course IS NULL OR TRIM(c.Target_Course) = '' OR TRIM(c.Target_Course) COLLATE NOCASE = ?)
                           AND (c.Target_Year IS NULL OR TRIM(c.Target_Year) = '' OR TRIM(c.Target_Year) COLLATE NOCASE = ?)
                           AND (c.Target_Section IS NULL OR TRIM(c.Target_Section) = '' OR TRIM(c.Target_Section) COLLATE NOCASE = ?)`
                    ).bind(sCourse, sYear, sSection).all();
                } else {
                    courses = await env.DB.prepare(
                        `SELECT c.*, u.Name as LecturerName 
                         FROM Courses c 
                         JOIN Users u ON c.Lecturer_ID = u.User_ID`
                    ).all();
                }
                
                return new Response(JSON.stringify({ success: true, courses: courses.results }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/enroll") {
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

            if (request.method === "POST" && path === "/api/unenroll") {
                const body = await request.json();
                
                if (!body.courseId || !body.studentId) {
                    return new Response(JSON.stringify({ error: "Missing required parameters." }), { status: 400, headers: corsHeaders });
                }

                await env.DB.prepare(
                    `DELETE FROM Enrollments WHERE Course_ID = ? AND Student_ID = ?`
                ).bind(body.courseId, body.studentId).run();

                await env.DB.prepare(
                    `DELETE FROM Attendance WHERE Course_ID = ? AND Student_ID = ?`
                ).bind(body.courseId, body.studentId).run();
                
                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/my-courses") {
                const userId = url.searchParams.get("userId");
                const role = url.searchParams.get("role");
                
                if (role === 'lecturer') {
                    const myCourses = await env.DB.prepare(
                        `SELECT * FROM Courses WHERE Lecturer_ID = ?`
                    ).bind(userId).all();
                    return new Response(JSON.stringify({ success: true, courses: myCourses.results }), { status: 200, headers: corsHeaders });
                } else {
                    const enrolled = await env.DB.prepare(
                        `SELECT c.*, u.Name as LecturerName, e.Seat_Number 
                         FROM Enrollments e 
                         JOIN Courses c ON e.Course_ID = c.Course_ID 
                         JOIN Users u ON c.Lecturer_ID = u.User_ID 
                         WHERE e.Student_ID = ?`
                    ).bind(userId).all();
                    return new Response(JSON.stringify({ success: true, courses: enrolled.results }), { status: 200, headers: corsHeaders });
                }
            }

            if (request.method === "GET" && path === "/api/course-details") {
                const courseId = url.searchParams.get("courseId");
                if (!courseId) {
                    return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers: corsHeaders });
                }

                const course = await env.DB.prepare("SELECT * FROM Courses WHERE Course_ID = ?").bind(courseId).first();
                if (!course) {
                    return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers: corsHeaders });
                }

                const students = await env.DB.prepare(
                    `SELECT u.User_ID, u.Name, u.Avatar, u.Student_Number, u.course, u.year, u.section, u.Email, u.Contact_Number, u.eye_condition, u.account_status, e.Seat_Number, e.Group_Name, e.Assigned_Topic 
                     FROM Enrollments e 
                     JOIN Users u ON e.Student_ID = u.User_ID 
                     WHERE e.Course_ID = ?`
                ).bind(courseId).all();

                return new Response(JSON.stringify({ success: true, course: course, students: students.results }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/unenrolled-students") {
                const courseId = url.searchParams.get("courseId");
                const courseFilter = url.searchParams.get("courseFilter");
                const yearFilter = url.searchParams.get("yearFilter");
                const sectionFilter = url.searchParams.get("sectionFilter");
                const statusFilter = url.searchParams.get("statusFilter");
                
                if (!courseId) {
                    return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers: corsHeaders });
                }

                let query = `SELECT User_ID, Student_Number, Name, course, year, section, account_status 
                             FROM Users 
                             WHERE role COLLATE NOCASE = 'student' 
                             AND User_ID NOT IN (SELECT Student_ID FROM Enrollments WHERE Course_ID = ?)`;
                const params = [courseId];

                if (statusFilter) {
                    query += ` AND account_status COLLATE NOCASE = ?`;
                    params.push(statusFilter);
                }
                if (courseFilter) {
                    query += ` AND course COLLATE NOCASE = ?`;
                    params.push(courseFilter);
                }
                if (yearFilter) {
                    query += ` AND year COLLATE NOCASE = ?`;
                    params.push(yearFilter);
                }
                if (sectionFilter) {
                    query += ` AND section COLLATE NOCASE = ?`;
                    params.push(sectionFilter);
                }

                query += ` ORDER BY Name ASC`;
                const students = await env.DB.prepare(query).bind(...params).all();

                return new Response(JSON.stringify({ success: true, students: students.results }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/update-student-info") {
                const body = await request.json();
                
                await env.DB.prepare(
                    `UPDATE Enrollments SET Seat_Number = ?, Group_Name = ?, Assigned_Topic = ? WHERE Course_ID = ? AND Student_ID = ?`
                ).bind(body.seatNumber, body.groupName, body.assignedTopic, body.courseId, body.studentId).run();
                
                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/no-class") {
                const courseId = url.searchParams.get("courseId");
                const sessions = await env.DB.prepare(
                    "SELECT Date FROM Course_Sessions WHERE Course_ID = ? AND Is_No_Class = 1 ORDER BY Date DESC"
                ).bind(courseId).all();
                return new Response(JSON.stringify({ success: true, dates: sessions.results }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/no-class") {
                const body = await request.json();
                const { courseId, date } = body;

                if (!courseId || !date) {
                    return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400, headers: corsHeaders });
                }

                const existing = await env.DB.prepare("SELECT Session_ID FROM Course_Sessions WHERE Course_ID = ? AND Date = ?").bind(courseId, date).first();
                if (!existing) {
                    const sessionId = crypto.randomUUID();
                    await env.DB.prepare("INSERT INTO Course_Sessions (Session_ID, Course_ID, Date, Is_No_Class) VALUES (?, ?, ?, 1)").bind(sessionId, courseId, date).run();
                    
                    await env.DB.prepare("DELETE FROM Attendance WHERE Course_ID = ? AND Date = ?").bind(courseId, date).run();
                }

                return new Response(JSON.stringify({ success: true }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "DELETE" && path === "/api/no-class") {
                const body = await request.json();
                const { courseId, date } = body;
                
                await env.DB.prepare("DELETE FROM Course_Sessions WHERE Course_ID = ? AND Date = ? AND Is_No_Class = 1").bind(courseId, date).run();
                
                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/attendance") {
                const courseId = url.searchParams.get("courseId");
                const date = url.searchParams.get("date");
                
                if (!courseId || !date) {
                    return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400, headers: corsHeaders });
                }

                const session = await env.DB.prepare(
                    "SELECT Is_No_Class FROM Course_Sessions WHERE Course_ID = ? AND Date = ?"
                ).bind(courseId, date).first();
                
                const isNoClass = session ? session.Is_No_Class === 1 : false;

                const records = await env.DB.prepare(
                    "SELECT Student_ID, Status, Performance_Points FROM Attendance WHERE Course_ID = ? AND Date = ?"
                ).bind(courseId, date).all();

                return new Response(JSON.stringify({ success: true, records: records.results, isNoClass: isNoClass }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/attendance") {
                const body = await request.json();
                const { courseId, date, records } = body;

                if (!courseId || !date) {
                    return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400, headers: corsHeaders });
                }

                if (records && Array.isArray(records)) {
                    await env.DB.prepare("DELETE FROM Attendance WHERE Course_ID = ? AND Date = ?").bind(courseId, date).run();

                    if (records.length > 0) {
                        const statements = [];
                        for (const record of records) {
                            const attId = crypto.randomUUID();
                            statements.push(
                                env.DB.prepare(
                                    "INSERT INTO Attendance (Attendance_ID, Course_ID, Student_ID, Date, Status, Performance_Points) VALUES (?, ?, ?, ?, ?, ?)"
                                ).bind(attId, courseId, record.studentId, date, record.status, record.points)
                            );
                        }
                        await env.DB.batch(statements);
                    }
                }

                return new Response(JSON.stringify({ success: true, message: "Attendance saved" }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/attendance/single") {
                const body = await request.json();
                const { courseId, studentId, date, status, points } = body;
                
                if (!courseId || !studentId || !date) {
                    return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400, headers: corsHeaders });
                }

                await env.DB.prepare("DELETE FROM Attendance WHERE Course_ID = ? AND Student_ID = ? AND Date = ?").bind(courseId, studentId, date).run();

                if (status) {
                    const attId = crypto.randomUUID();
                    await env.DB.prepare(
                        "INSERT INTO Attendance (Attendance_ID, Course_ID, Student_ID, Date, Status, Performance_Points) VALUES (?, ?, ?, ?, ?, ?)"
                    ).bind(attId, courseId, studentId, date, status, points || 0).run();
                }
                
                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/student-summary") {
                const courseId = url.searchParams.get("courseId");
                const studentId = url.searchParams.get("studentId");
                
                if (!courseId || !studentId) {
                    return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400, headers: corsHeaders });
                }

                const course = await env.DB.prepare("SELECT Midterm_Start, Midterm_End, Final_Start, Final_End, ScheduleDay FROM Courses WHERE Course_ID = ?").bind(courseId).first();
                if (!course) {
                    return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers: corsHeaders });
                }

                const sessions = await env.DB.prepare("SELECT Date, Is_No_Class FROM Course_Sessions WHERE Course_ID = ?").bind(courseId).all();

                const records = await env.DB.prepare(
                    "SELECT Date, Status, Performance_Points FROM Attendance WHERE Course_ID = ? AND Student_ID = ? ORDER BY Date ASC"
                ).bind(courseId, studentId).all();

                const enrollment = await env.DB.prepare(
                    "SELECT Seat_Number, Group_Name, Assigned_Topic FROM Enrollments WHERE Course_ID = ? AND Student_ID = ?"
                ).bind(courseId, studentId).first();

                const submissions = await env.DB.prepare(
                    "SELECT * FROM Submissions WHERE Course_ID = ? AND Student_ID = ? ORDER BY Timestamp DESC"
                ).bind(courseId, studentId).all();

                return new Response(JSON.stringify({ 
                    success: true, 
                    course: course,
                    sessions: sessions.results,
                    records: records.results,
                    enrollment: enrollment || {},
                    submissions: submissions.results
                }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/recitation-pool") {
                const courseId = url.searchParams.get("courseId");
                if (!courseId) {
                    return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers: corsHeaders });
                }

                const pool = await env.DB.prepare(`
                    SELECT u.User_ID, u.Name, u.Avatar, COALESCE(SUM(a.Performance_Points), 0) as Total_Points
                    FROM Enrollments e
                    JOIN Users u ON e.Student_ID = u.User_ID
                    LEFT JOIN Attendance a ON e.Student_ID = a.Student_ID AND e.Course_ID = a.Course_ID
                    WHERE e.Course_ID = ?
                    GROUP BY u.User_ID, u.Name, u.Avatar
                `).bind(courseId).all();

                return new Response(JSON.stringify({ success: true, students: pool.results }), { status: 200, headers: corsHeaders });
            }

            return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: corsHeaders });

        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
    }
};
