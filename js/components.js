// js/components.js

// Helper function to bypass Google Drive's hotlinking block for legacy accounts
const getLoadableAvatarSrc = (src) => {
    if (!src) return null;
    if (src.includes('drive.google.com/uc')) {
        const match = src.match(/[?&]id=([^&]+)/);
        if (match && match[1]) {
            return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1000`;
        }
    }
    return src;
};

export const Components = {
    renderLogin: () => `
        <div class="flex flex-col justify-center items-center min-h-screen p-4">
            <div class="w-full max-w-md bg-white rounded-lg shadow-md p-8 fade-in">
                <div class="text-center mb-8">
                    <i class="fa-solid fa-graduation-cap text-4xl text-blue-600 mb-4"></i>
                    <h2 class="text-2xl font-bold text-gray-800">Welcome Back</h2>
                    <p class="text-gray-500 text-sm">Please sign in to your account</p>
                </div>
                <form id="loginForm" class="space-y-4">
                    <div id="loginError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm"></div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Username, Email, Contact, or Student No.</label>
                        <input type="text" id="loginIdentifier" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Password</label>
                        <input type="password" id="loginPassword" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                    </div>
                    <button type="submit" class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                        Sign In
                    </button>
                </form>
                <div class="mt-6 text-center">
                    <p class="text-sm text-gray-600">Don't have an account? <a href="#register" class="text-blue-600 font-medium hover:text-blue-500">Register here</a></p>
                </div>
            </div>
        </div>
    `,

    renderRegister: () => `
        <div class="flex flex-col justify-center items-center min-h-screen p-4">
            <div class="w-full max-w-lg bg-white rounded-lg shadow-md p-8 fade-in my-8">
                <div class="text-center mb-8">
                    <i class="fa-solid fa-user-plus text-4xl text-green-600 mb-4"></i>
                    <h2 class="text-2xl font-bold text-gray-800">Create Account</h2>
                    <p class="text-gray-500 text-sm">Fill in your details to register</p>
                </div>
                <form id="registerForm" class="space-y-4">
                    <div id="registerError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm"></div>
                    <div id="registerSuccess" class="hidden bg-green-100 text-green-700 p-3 rounded text-sm">Registration successful! Redirecting to login...</div>
                    
                    <div class="border-2 border-dashed border-gray-300 rounded-md p-4 text-center mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-3">Profile Photo (Required)</label>
                        <div class="flex justify-center mb-3">
                            <img id="avatarPreview" class="hidden w-24 h-24 rounded-full object-cover aspect-square border-2 border-green-500 shadow-sm" />
                        </div>
                        <div class="flex justify-center space-x-3">
                            <button type="button" id="btnCamera" class="px-4 py-2 bg-gray-100 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-200 focus:outline-none">
                                <i class="fa-solid fa-camera mr-2"></i> Camera
                            </button>
                            <button type="button" id="btnFile" class="px-4 py-2 bg-gray-100 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-200 focus:outline-none">
                                <i class="fa-solid fa-upload mr-2"></i> File
                            </button>
                        </div>
                        <input type="file" id="regCameraInput" accept="image/*" capture="camera" class="hidden" />
                        <input type="file" id="regFileInput" accept="image/*" class="hidden" />
                        <input type="hidden" id="regAvatarBase64" />
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Name</label>
                            <input type="text" id="regName" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Username</label>
                            <input type="text" id="regUsername" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Student Number</label>
                            <input type="text" id="regStudentNo" required placeholder="00-0000" maxlength="7" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 font-mono">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Contact Number</label>
                            <input type="text" id="regContact" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                        </div>
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700">Email</label>
                        <input type="email" id="regEmail" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Password</label>
                        <input type="password" id="regPassword" required minlength="6" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Course</label>
                            <select id="regCourse" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                                <option value="" disabled selected>Loading courses...</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Year</label>
                            <input type="text" id="regYear" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                        </div>
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700">Section</label>
                        <input type="text" id="regSection" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                    </div>
                    
                    <button type="submit" id="regSubmitBtn" class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 mt-4">
                        Create Account
                    </button>
                </form>
                <div class="mt-6 text-center">
                    <p class="text-sm text-gray-600">Already have an account? <a href="#login" class="text-green-600 font-medium hover:text-green-500">Sign in here</a></p>
                </div>
            </div>
        </div>
    `,

    renderDashboard: (user) => {
        const avatarSrc = getLoadableAvatarSrc(user.Avatar);
        const headerAvatar = avatarSrc ? `<img src="${avatarSrc}" class="w-10 h-10 rounded-full object-cover aspect-square border-2 border-gray-200 shadow-sm" alt="Profile Picture" />` : '<i class="fa-solid fa-circle-user text-3xl text-gray-400"></i>';
        const panelAvatar = avatarSrc ? `<img src="${avatarSrc}" class="w-28 h-28 rounded-full object-cover aspect-square border-4 border-white shadow-lg mx-auto" alt="Profile Picture" />` : '<i class="fa-solid fa-circle-user text-7xl text-gray-400 mx-auto block text-center"></i>';
        
        let displayCourse = 'N/A';
        if (user.course) {
            displayCourse = `${user.course} ${user.year || ''} ${user.section ? '- ' + user.section : ''}`.trim().replace(/\s+/g, ' ');
        }
        
        const createCourseBtn = user.role.toLowerCase() === 'lecturer' ? `
            <div class="mt-6">
                <button id="openCreateCourseModalBtn" class="w-full flex justify-center py-2 px-4 border border-blue-300 rounded-md shadow-sm text-sm font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 focus:outline-none transition-colors">
                    <i class="fa-solid fa-folder-plus mr-2 mt-0.5"></i> Create New Course Module
                </button>
            </div>
        ` : '';

        const createProgramBtn = user.role.toLowerCase() === 'lecturer' ? `
            <div class="mt-3">
                <button id="openApModalBtn" class="w-full flex justify-center py-2 px-4 border border-purple-300 rounded-md shadow-sm text-sm font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 focus:outline-none transition-colors">
                    <i class="fa-solid fa-graduation-cap mr-2 mt-0.5"></i> Add Registration Course List
                </button>
            </div>
        ` : '';

        return `
        <!-- Top Header Bar -->
        <header class="bg-white shadow-sm fixed top-0 w-full z-40 border-b border-gray-200">
            <div class="w-full mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
                <div class="flex justify-between items-center h-16">
                    <div class="flex items-center">
                        <h1 class="text-xl font-bold text-gray-800 tracking-tight"><i class="fa-solid fa-house mr-2 text-blue-600"></i>Dashboard</h1>
                    </div>
                    <div class="flex items-center cursor-pointer hover:bg-gray-50 px-3 py-1 rounded-full transition-colors duration-200 border border-transparent hover:border-gray-200" id="profileToggleBtn">
                        <span class="mr-3 text-sm font-bold text-gray-700 hidden sm:block">${user.Name}</span>
                        ${headerAvatar}
                    </div>
                </div>
            </div>
        </header>

        <!-- Main Content (Courses Container) -->
        <main class="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full fade-in">
            <div id="courseContainer" class="w-full"></div>
        </main>

        <!-- Sliding Profile Panel overlay with blur -->
        <div id="profilePanelOverlay" class="fixed inset-0 bg-gray-900 bg-opacity-40 backdrop-blur-sm z-40 hidden transition-opacity"></div>
        
        <!-- Sliding Profile Panel -->
        <div id="profilePanel" class="fixed inset-y-0 right-0 w-4/5 sm:w-96 bg-white shadow-2xl z-50 transform translate-x-full transition-transform duration-300 ease-in-out overflow-y-auto flex flex-col">
            <div class="p-6 bg-gradient-to-b from-blue-50 to-white flex-grow relative">
                <button id="closeProfilePanel" class="absolute top-4 right-4 text-gray-400 hover:text-gray-800 focus:outline-none transition-colors">
                    <i class="fa-solid fa-xmark text-2xl"></i>
                </button>
                
                <div class="text-center mt-6">
                    ${panelAvatar}
                    <h2 class="text-2xl font-bold text-gray-800 mt-4">${user.Name}</h2>
                </div>
                
                <!-- Side-by-Side Profile Information (Values Only) -->
                <div class="mt-8 px-2 space-y-4">
                    <!-- Row 1 -->
                    <div class="flex justify-between items-start border-b border-gray-200 pb-4">
                        <div class="flex-1 pr-1">
                            <span class="block text-sm font-bold text-blue-600">${user.role || 'N/A'}</span>
                        </div>
                        <div class="flex-1 text-center border-x border-gray-200 px-1">
                            <span class="block text-sm font-medium text-gray-800">${user.Student_Number || 'N/A'}</span>
                        </div>
                        <div class="flex-1 text-right pl-1">
                            <span class="block text-sm font-medium text-gray-800">${displayCourse}</span>
                        </div>
                    </div>
                    
                    <!-- Row 2 -->
                    <div class="flex justify-between items-start">
                        <div class="flex-1 pr-2">
                            <span class="block text-sm font-medium text-gray-800 break-all">${user.Email || 'N/A'}</span>
                        </div>
                        <div class="flex-1 text-right border-l border-gray-200 pl-2">
                            <span class="block text-sm font-medium text-gray-800">${user.Contact_Number || 'N/A'}</span>
                        </div>
                    </div>
                </div>

                ${createCourseBtn}
                ${createProgramBtn}

                <div class="mt-6">
                    <button id="openCpModalBtn" class="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-bold text-gray-700 bg-white hover:bg-gray-50 focus:outline-none transition-colors">
                        <i class="fa-solid fa-lock text-gray-400 mr-2 mt-0.5"></i> Change Password
                    </button>
                </div>
            </div>
            
            <div class="p-4 border-t border-gray-200 bg-white">
                <button id="logoutBtn" class="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-bold text-white bg-red-600 hover:bg-red-700 focus:outline-none transition-colors">
                    <i class="fa-solid fa-power-off mr-2"></i> Log Out
                </button>
            </div>
        </div>

        <!-- Change Password Pop-Up Modal -->
        <div id="cpModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in">
            <div id="cpModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-lg shadow-xl w-11/12 sm:w-96 p-6 relative z-10 scale-up">
                <div class="flex justify-between items-center mb-5 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-shield-halved text-blue-600 mr-2"></i>Change Password</h3>
                    <button id="closeCpModalBtn" class="text-gray-400 hover:text-gray-800 focus:outline-none transition-colors">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>
                
                <form id="changePasswordForm" class="space-y-4">
                    <div id="cpError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm font-medium"></div>
                    <div id="cpSuccess" class="hidden bg-green-100 text-green-700 p-3 rounded text-sm font-medium"></div>
                    
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Current Password</label>
                        <input type="password" id="cpCurrent" required class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">New Password</label>
                        <input type="password" id="cpNew" required minlength="6" class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Repeat New Password</label>
                        <input type="password" id="cpRepeat" required minlength="6" class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                    </div>
                    
                    <button type="submit" id="cpSubmitBtn" class="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none transition-colors mt-2">
                        Update Password
                    </button>
                </form>
            </div>
        </div>

        <!-- Create Course Pop-Up Modal -->
        <div id="ccModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in">
            <div id="ccModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-lg shadow-xl w-11/12 max-w-md p-6 relative z-10 scale-up max-h-[90vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-5 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-folder-plus text-blue-600 mr-2"></i>Create Course</h3>
                    <button id="closeCcModalBtn" class="text-gray-400 hover:text-gray-800 focus:outline-none transition-colors">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>
                
                <form id="addCourseForm" class="space-y-4">
                    <div id="courseError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm font-medium"></div>
                    
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Course Code</label>
                        <input type="text" id="courseCode" required class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm" placeholder="e.g. CS101">
                    </div>
                    
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Course Title</label>
                        <input type="text" id="courseTitle" required class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm" placeholder="e.g. Introduction to Programming">
                    </div>
                    
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Schedule Day</label>
                            <select id="scheduleDay" class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm">
                                <option>Monday</option><option>Tuesday</option><option>Wednesday</option>
                                <option>Thursday</option><option>Friday</option><option>Saturday</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Time Period</label>
                            <input type="text" id="timePeriod" required class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm" placeholder="9:00 AM - 12:00 PM">
                        </div>
                    </div>

                    <div class="border-t border-gray-200 pt-4 mt-4">
                        <p class="text-xs font-bold text-gray-800 mb-2 uppercase">Target Audience (Restriction)</p>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Target Course</label>
                                <select id="targetCourse" class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm">
                                    <option value="">All Courses</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Target Year</label>
                                <input type="text" id="targetYear" class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm" placeholder="e.g. 1">
                            </div>
                        </div>
                        <div class="mt-4">
                            <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Target Section</label>
                            <input type="text" id="targetSection" class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm" placeholder="e.g. A">
                        </div>
                        <p class="text-[10px] text-gray-500 mt-1 italic">*Leave blank to make it available to all students.</p>
                    </div>
                    
                    <button type="submit" id="addCourseBtn" class="w-full bg-blue-600 text-white py-2.5 px-4 rounded-md hover:bg-blue-700 shadow-sm font-bold transition-colors mt-4">
                        Create Course
                    </button>
                </form>
            </div>
        </div>

        <!-- Add Program Modal (For Registration List) -->
        <div id="apModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in">
            <div id="apModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-lg shadow-xl w-11/12 max-w-sm p-6 relative z-10 scale-up">
                <div class="flex justify-between items-center mb-5 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-graduation-cap text-purple-600 mr-2"></i>Add Course (Program)</h3>
                    <button id="closeApModalBtn" class="text-gray-400 hover:text-gray-800 focus:outline-none transition-colors">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>
                
                <form id="addProgramForm" class="space-y-4">
                    <div id="programError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm font-medium"></div>
                    <div id="programSuccess" class="hidden bg-green-100 text-green-700 p-3 rounded text-sm font-medium"></div>
                    
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Course / Program Code</label>
                        <input type="text" id="programCode" required class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-purple-500 outline-none bg-gray-50 text-sm uppercase" placeholder="e.g. BSCS">
                    </div>
                    
                    <button type="submit" id="addProgramBtn" class="w-full bg-purple-600 text-white py-2.5 px-4 rounded-md hover:bg-purple-700 shadow-sm font-bold transition-colors mt-4">
                        Add to Registration List
                    </button>
                </form>
            </div>
        </div>
        `;
    },

    renderClassScreen: (course, students) => {
        const studentList = students.map((s, index) => {
            const avatarSrc = getLoadableAvatarSrc(s.Avatar);
            const avatarImg = avatarSrc 
                ? `<img src="${avatarSrc}" class="w-12 h-12 rounded-full object-cover border border-gray-200" alt="${s.Name}">` 
                : `<i class="fa-solid fa-circle-user text-[48px] text-gray-300"></i>`;
            
            const displayCourse = `${s.course || ''} ${s.year || ''} ${s.section ? '- ' + s.section : ''}`.trim();
            
            return `
                <div class="flex items-center justify-between p-4 bg-white border-b border-gray-100 hover:bg-gray-50 transition student-row" data-student-id="${s.User_ID}">
                    
                    <!-- Profile Info -->
                    <div class="flex items-center space-x-4 w-1/3">
                        <span class="text-xs font-bold text-gray-400 w-6 text-center">${index + 1}</span>
                        <div class="flex-shrink-0">
                            ${avatarImg}
                        </div>
                        <div>
                            <div class="font-bold text-gray-800">${s.Name}</div>
                            <div class="text-xs text-gray-500 mt-0.5">
                                <span class="font-medium text-gray-700">${s.Student_Number || 'N/A'}</span> &bull; ${displayCourse || 'N/A'}
                            </div>
                        </div>
                    </div>

                    <!-- Editable Seat & Group Info -->
                    <div class="flex items-center space-x-2 w-1/4 justify-center">
                        <div>
                            <label class="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5 text-center">Seat</label>
                            <input type="text" placeholder="--" class="seat-input w-16 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 outline-none text-center bg-gray-50 focus:bg-white transition" value="${s.Seat_Number || ''}" data-student-id="${s.User_ID}">
                        </div>
                        <div>
                            <label class="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5 text-center">Group</label>
                            <input type="text" placeholder="--" class="group-input w-24 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 outline-none text-center bg-gray-50 focus:bg-white transition" value="${s.Group_Name || ''}" data-student-id="${s.User_ID}">
                        </div>
                    </div>
                    
                    <!-- Attendance Action Toggles & Points -->
                    <div class="flex items-end space-x-2">
                        <div>
                            <label class="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5 text-center">Pts (+/-)</label>
                            <input type="number" placeholder="0" class="points-input w-16 px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 outline-none text-center mr-2 bg-gray-50 focus:bg-white transition font-mono" value="0">
                        </div>
                        <div class="flex space-x-1">
                            <button type="button" data-status="Present" class="attendance-btn px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-200 text-gray-600 bg-gray-50 hover:bg-green-50 hover:text-green-700 hover:border-green-300 transition">
                                Present
                            </button>
                            <button type="button" data-status="Late" class="attendance-btn px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-200 text-gray-600 bg-gray-50 hover:bg-yellow-50 hover:text-yellow-700 hover:border-yellow-300 transition">
                                Late
                            </button>
                            <button type="button" data-status="Absent" class="attendance-btn px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-200 text-gray-600 bg-gray-50 hover:bg-red-50 hover:text-red-700 hover:border-red-300 transition">
                                Absent
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const emptyState = `<div class="p-8 text-center text-gray-500 bg-white rounded-b-xl border-dashed border-gray-300">No students enrolled yet.</div>`;

        return `
        <!-- Top Header Bar -->
        <header class="bg-blue-700 shadow-md fixed top-0 w-full z-40">
            <div class="w-full mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl">
                <div class="flex items-center h-16">
                    <a href="#dashboard" class="text-white hover:text-blue-200 transition mr-4 p-2 -ml-2">
                        <i class="fa-solid fa-arrow-left text-xl"></i>
                    </a>
                    <div class="overflow-hidden">
                        <h1 class="text-lg font-bold text-white truncate">${course.CourseCode}</h1>
                        <p class="text-xs text-blue-200 truncate">${course.CourseTitle}</p>
                    </div>
                </div>
            </div>
        </header>

        <!-- Main Content -->
        <main class="pt-20 pb-12 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full fade-in">
            <!-- Action Header -->
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 mt-4 gap-4">
                <div>
                    <h2 class="text-2xl font-black text-gray-800 tracking-tight">Class Roster & Attendance</h2>
                    <p class="text-sm text-gray-500 mt-1"><i class="fa-regular fa-clock mr-1"></i> ${course.ScheduleDay} | ${course.TimePeriod}</p>
                </div>
                
                <div class="flex items-center space-x-3 w-full sm:w-auto">
                    <button id="openAddStudentModalBtn" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center flex-1 sm:flex-initial">
                        <i class="fa-solid fa-user-plus mr-2"></i> Enroll Student
                    </button>
                    <input type="date" id="attendanceDate" class="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white font-medium focus:ring-2 focus:ring-blue-500 outline-none" value="${new Date().toISOString().split('T')[0]}">
                    <button id="saveAttendanceBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center flex-1 sm:flex-initial">
                        <i class="fa-solid fa-floppy-disk mr-2"></i> Save Attendance
                    </button>
                </div>
            </div>
            
            <div id="attendanceAlert" class="hidden mb-4 p-3 rounded-md text-sm font-medium"></div>

            <!-- Student List Container -->
            <div class="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden">
                <div class="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                    <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">
                        ${students.length} Enrolled Students (Sorted A-Z)
                    </span>
                    <div class="space-x-2">
                        <button type="button" id="markAllPresent" class="text-xs font-bold text-green-600 hover:text-green-800 underline">Mark All Present</button>
                    </div>
                </div>
                <div>
                    ${students.length > 0 ? studentList : emptyState}
                </div>
            </div>
        </main>

        <!-- Add Student Modal -->
        <div id="addStudentModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm modal-backdrop" id="closeAddStudentModalBg"></div>
            <div class="bg-white rounded-lg shadow-xl w-11/12 max-w-2xl p-6 relative z-10 scale-up max-h-[90vh] flex flex-col">
                <div class="flex justify-between items-center mb-5 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-user-plus text-green-600 mr-2"></i>Manually Enroll Student</h3>
                    <button id="closeAddStudentModalBtn" class="text-gray-400 hover:text-gray-800 transition-colors">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>
                <div class="mb-4">
                    <input type="text" id="studentSearchInput" placeholder="Search by Name or Student No..." class="w-full px-4 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-gray-50">
                </div>
                <div id="unenrolledStudentsList" class="flex-1 overflow-y-auto space-y-2 min-h-[300px] bg-gray-50 p-2 rounded border border-gray-200">
                    <div class="text-center py-10 text-gray-500 text-sm"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-blue-600"></i><br>Loading students...</div>
                </div>
            </div>
        </div>
        `;
    }
};
