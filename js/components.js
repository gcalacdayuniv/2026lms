// js/components.js

// Helper function to bypass Google Drive's hotlinking block for legacy accounts
export const getLoadableAvatarSrc = (src) => {
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
            <div class="w-full max-w-md bg-white rounded-lg shadow-md p-6 sm:p-8 fade-in">
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
                        <div class="relative">
                            <input type="password" id="loginPassword" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10">
                            <button type="button" id="toggleLoginPassword" class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-blue-600 mt-1 focus:outline-none">
                                <i class="fa-solid fa-eye" id="loginPasswordEye"></i>
                            </button>
                        </div>
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
            <div class="w-full max-w-lg bg-white rounded-lg shadow-md p-6 sm:p-8 fade-in my-8">
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
                        <div class="flex flex-col sm:flex-row justify-center items-center space-y-2 sm:space-y-0 sm:space-x-3 w-full">
                            <button type="button" id="btnCamera" class="w-full sm:w-auto px-4 py-2 bg-gray-100 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-200 focus:outline-none">
                                <i class="fa-solid fa-camera mr-2"></i> Camera
                            </button>
                            <button type="button" id="btnFile" class="w-full sm:w-auto px-4 py-2 bg-gray-100 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-200 focus:outline-none">
                                <i class="fa-solid fa-upload mr-2"></i> File
                            </button>
                        </div>
                        <input type="file" id="regCameraInput" accept="image/*" capture="camera" class="hidden" />
                        <input type="file" id="regFileInput" accept="image/*" class="hidden" />
                        <input type="hidden" id="regAvatarBase64" />
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Given Name</label>
                            <input type="text" id="regGivenName" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Last Name</label>
                            <input type="text" id="regLastName" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Suffix</label>
                            <input type="text" id="regSuffix" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="e.g. Jr. (Optional)">
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Username</label>
                            <input type="text" id="regUsername" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Email</label>
                            <input type="email" id="regEmail" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Student Number</label>
                            <input type="text" id="regStudentNo" required placeholder="00-0000" maxlength="7" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 font-mono">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Contact Number</label>
                            <input type="text" id="regContact" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                        </div>
                    </div>
                    
                    <div class="mt-4">
                        <label class="block text-sm font-medium text-gray-700">Password</label>
                        <input type="password" id="regPassword" required minlength="6" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Course</label>
                            <select id="regCourse" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                                <option value="" disabled selected>Loading courses...</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Year</label>
                            <select id="regYear" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                                <option value="" disabled selected>Select Year</option>
                                <option value="1">1</option>
                                <option value="2">2</option>
                                <option value="3">3</option>
                                <option value="4">4</option>
                                <option value="5">5</option>
                            </select>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Section</label>
                            <select id="regSection" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                                <option value="" disabled selected>Select Section</option>
                                ${Array.from({length: 30}, (_, i) => `<option value="${i+1}">${i+1}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Eye Condition</label>
                            <select id="regEyeCondition" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                                <option value="" disabled selected>Select Condition</option>
                                <option value="No Eye Condition">No Eye Condition</option>
                                <option value="Near Sighted">Near Sighted</option>
                                <option value="Far Sighted">Far Sighted</option>
                            </select>
                        </div>
                    </div>
                    
                    <button type="submit" id="regSubmitBtn" class="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 mt-4">
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
        
        let displayCourse = 'N/A';
        if (user.course) {
            displayCourse = `${user.course} ${user.year || ''} ${user.section ? '- ' + user.section : ''}`.trim().replace(/\s+/g, ' ');
        }
        
        const panelAvatar = avatarSrc ? `<img src="${avatarSrc}" class="w-28 h-28 rounded-full object-cover aspect-square border-4 border-white shadow-lg mx-auto cursor-pointer view-avatar-btn hover:opacity-80 transition" data-src="${avatarSrc}" data-name="${user.Name}" data-info="${displayCourse}" role="button" tabindex="0" alt="Profile Picture" />` : '<i class="fa-solid fa-circle-user text-7xl text-gray-400 mx-auto block text-center"></i>';

        const createCourseBtn = user.role.toLowerCase() === 'lecturer' ? `
            <div class="mt-6">
                <button id="openCreateCourseModalBtn" class="w-full flex justify-center py-2 px-4 border border-blue-300 rounded-md shadow-sm text-sm font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 focus:outline-none transition-colors">
                    <i class="fa-solid fa-folder-plus mr-2 mt-0.5"></i> Create New Course
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

        const manageUsersBtn = user.role.toLowerCase() === 'lecturer' ? `
            <div class="mt-3">
                <button id="openMuModalBtn" class="w-full flex justify-center py-2 px-4 border border-green-300 rounded-md shadow-sm text-sm font-bold text-green-700 bg-green-50 hover:bg-green-100 focus:outline-none transition-colors">
                    <i class="fa-solid fa-users-gear mr-2 mt-0.5"></i> Manage Users
                </button>
            </div>
        ` : '';

        return `
        <!-- Top Header Bar -->
        <header class="bg-white shadow-sm fixed top-0 w-full z-40 border-b border-gray-200">
            <div class="w-full mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
                <div class="flex justify-between items-center h-16">
                    <div class="flex items-center">
                        <h1 class="text-lg sm:text-xl font-bold text-gray-800 tracking-tight"><i class="fa-solid fa-house mr-2 text-blue-600"></i>Dashboard</h1>
                    </div>
                    <div class="flex items-center cursor-pointer hover:bg-gray-50 px-2 sm:px-3 py-1 rounded-full transition-colors duration-200 border border-transparent hover:border-gray-200" id="profileToggleBtn">
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
                    <h2 class="text-xl sm:text-2xl font-bold text-gray-800 mt-4">${user.Name}</h2>
                </div>
                
                <!-- Side-by-Side Profile Information (Values Only) -->
                <div class="mt-8 px-2 space-y-4">
                    <!-- Row 1 -->
                    <div class="flex justify-between items-start border-b border-gray-200 pb-4">
                        <div class="flex-1 pr-1">
                            <span class="block text-xs sm:text-sm font-bold text-blue-600">${user.role || 'N/A'}</span>
                        </div>
                        <div class="flex-1 text-center border-x border-gray-200 px-1">
                            <span class="block text-xs sm:text-sm font-medium text-gray-800 break-all">${user.Student_Number || 'N/A'}</span>
                        </div>
                        <div class="flex-1 text-right pl-1">
                            <span class="block text-xs sm:text-sm font-medium text-gray-800">${displayCourse}</span>
                        </div>
                    </div>
                    
                    <!-- Row 2 -->
                    <div class="flex flex-col sm:flex-row justify-between items-start space-y-2 sm:space-y-0">
                        <div class="flex-1 pr-2 w-full">
                            <span class="block text-xs sm:text-sm font-medium text-gray-800 break-all">${user.Email || 'N/A'}</span>
                        </div>
                        <div class="flex-1 text-left sm:text-right sm:border-l border-gray-200 sm:pl-2 w-full">
                            <span class="block text-xs sm:text-sm font-medium text-gray-800">${user.Contact_Number || 'N/A'}</span>
                        </div>
                    </div>
                </div>

                ${createCourseBtn}
                ${createProgramBtn}
                ${manageUsersBtn}

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

        <!-- Manage Users Modal (Lecturer Only) -->
        <div id="muModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-2 sm:p-4">
            <div id="muModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl p-4 sm:p-6 relative z-10 scale-up max-h-[95vh] sm:max-h-[90vh] flex flex-col">
                <div class="flex justify-between items-center mb-5 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-users-gear text-green-600 mr-2"></i>Manage Users</h3>
                    <button id="closeMuModalBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>
                
                <div class="mb-4 flex flex-col sm:flex-row gap-2">
                    <input type="text" id="muSearchInput" placeholder="Search by Name or Student No..." class="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-gray-50">
                    <select id="muFilterStatus" class="w-full sm:w-40 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50 font-medium">
                        <option value="">All Statuses</option>
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                        <option value="Suspended">Suspended</option>
                        <option value="UD">UD</option>
                        <option value="Dropped">Dropped</option>
                    </select>
                </div>

                <div id="manageUsersList" class="flex-1 overflow-y-auto space-y-2 min-h-[300px] bg-gray-50 p-2 rounded border border-gray-200">
                    <!-- Dynamic content -->
                </div>
            </div>
        </div>

        <!-- Change Password Pop-Up Modal -->
        <!-- ... (Rest of dashboard modals: cpModal, ccModal, apModal) ... -->
        <div id="cpModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-4">
            <div id="cpModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-sm p-4 sm:p-6 relative z-10 scale-up">
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
        <div id="ccModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-4">
            <div id="ccModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-4 sm:p-6 relative z-10 scale-up max-h-[90vh] overflow-y-auto">
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
                    
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        <div id="apModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-4">
            <div id="apModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-sm p-4 sm:p-6 relative z-10 scale-up">
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
        const eyeOrder = { 'Near Sighted': 1, 'No Eye Condition': 2, 'Far Sighted': 3 };
        
        students.sort((a, b) => {
            const seatAStr = (a.Seat_Number || '').toString().trim();
            const seatBStr = (b.Seat_Number || '').toString().trim();
            const hasSeatA = seatAStr !== '';
            const hasSeatB = seatBStr !== '';

            if (hasSeatA && !hasSeatB) return -1;
            if (!hasSeatA && hasSeatB) return 1;

            if (hasSeatA && hasSeatB) {
                const numA = parseFloat(seatAStr);
                const numB = parseFloat(seatBStr);
                if (!isNaN(numA) && !isNaN(numB)) {
                    if (numA !== numB) return numA - numB;
                } else {
                    if (seatAStr !== seatBStr) return seatAStr.localeCompare(seatBStr);
                }
            }

            const eyeA = eyeOrder[a.eye_condition] || 4;
            const eyeB = eyeOrder[b.eye_condition] || 4;
            if (eyeA !== eyeB) return eyeA - eyeB;

            const nameA = a.Name || '';
            const nameB = b.Name || '';
            return nameA.localeCompare(nameB);
        });

        const studentList = students.map((s, index) => {
            const avatarSrc = getLoadableAvatarSrc(s.Avatar);
            const displayCourse = `${s.course || ''} ${s.year || ''} ${s.section ? '- ' + s.section : ''}`.trim();

            const avatarImg = avatarSrc 
                ? `<img src="${avatarSrc}" class="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover border border-gray-200 cursor-pointer view-avatar-btn hover:opacity-80 transition" data-src="${avatarSrc}" data-name="${s.Name}" data-info="${displayCourse}" role="button" tabindex="0" alt="${s.Name}">` 
                : `<i class="fa-solid fa-circle-user text-[40px] sm:text-[48px] text-gray-300"></i>`;
            
            const eyeConditionBadge = s.eye_condition 
                ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-800 border border-purple-200"><i class="fa-regular fa-eye mr-1"></i> ${s.eye_condition}</span>`
                : '';

            return `
                <div class="flex flex-col md:flex-row items-start md:items-center justify-between p-4 bg-white border-b border-gray-100 hover:bg-gray-50 transition student-row gap-4 md:gap-2" data-student-id="${s.User_ID}">
                    
                    <!-- Profile Info & Manage Button (Mobile Stack) -->
                    <div class="flex items-start justify-between w-full md:w-1/2">
                        <div class="flex items-center space-x-3">
                            <span class="text-xs font-bold text-gray-400 w-5 text-center">${index + 1}</span>
                            <div class="flex-shrink-0">
                                ${avatarImg}
                            </div>
                            <div>
                                <div class="font-bold text-gray-800 text-sm sm:text-base">${s.Name}</div>
                                <div class="text-[11px] sm:text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-1">
                                    <span class="font-medium text-gray-700">${s.Student_Number || 'N/A'}</span> &bull; ${displayCourse || 'N/A'} ${eyeConditionBadge}
                                </div>
                                <div class="text-[10px] font-bold text-gray-400 mt-1 uppercase">
                                    Seat: <span class="text-gray-800">${s.Seat_Number || '--'}</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="md:hidden">
                            <!-- Mobile Manage Button -->
                            <button type="button" class="manage-student-btn px-2 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 rounded text-xs font-bold border border-blue-200 transition shadow-sm" 
                                data-student-id="${s.User_ID}" 
                                data-name="${s.Name}" 
                                data-seat="${s.Seat_Number || ''}" 
                                data-group="${s.Group_Name || ''}" 
                                data-status="${s.account_status || 'Inactive'}">
                                <i class="fa-solid fa-gear"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Manage Actions (Desktop) -->
                    <div class="hidden md:flex items-center justify-center w-auto px-2">
                        <button type="button" class="manage-student-btn px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 rounded text-xs font-bold border border-blue-200 transition flex items-center shadow-sm" 
                            data-student-id="${s.User_ID}" 
                            data-name="${s.Name}" 
                            data-seat="${s.Seat_Number || ''}" 
                            data-group="${s.Group_Name || ''}" 
                            data-status="${s.account_status || 'Inactive'}">
                            <i class="fa-solid fa-gear mr-1"></i> Manage
                        </button>
                    </div>
                    
                    <!-- Attendance Action Toggles & Points -->
                    <div class="flex items-end justify-between md:justify-end w-full md:w-auto space-x-2 border-t md:border-t-0 border-gray-100 pt-3 md:pt-0 mt-1 md:mt-0">
                        <div class="flex items-center md:items-start md:flex-col gap-2 md:gap-0">
                            <label class="block text-[9px] font-bold text-gray-400 uppercase tracking-wider md:mb-0.5 text-center">Pts</label>
                            <input type="number" placeholder="0" class="points-input w-16 px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 outline-none text-center bg-gray-50 focus:bg-white transition font-mono" value="0">
                        </div>
                        <div class="flex space-x-1 flex-1 md:flex-initial justify-end">
                            <button type="button" data-status="Present" data-selected="true" class="attendance-btn flex-1 md:flex-initial px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold border border-green-400 text-green-800 bg-green-100 hover:bg-green-50 hover:text-green-700 transition text-center">
                                Present
                            </button>
                            <button type="button" data-status="Late" class="attendance-btn flex-1 md:flex-initial px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold border border-gray-200 text-gray-600 bg-gray-50 hover:bg-yellow-50 hover:text-yellow-700 transition text-center">
                                Late
                            </button>
                            <button type="button" data-status="Absent" class="attendance-btn flex-1 md:flex-initial px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold border border-gray-200 text-gray-600 bg-gray-50 hover:bg-red-50 hover:text-red-700 transition text-center">
                                Absent
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const emptyState = `<div class="p-8 text-center text-gray-500 bg-white rounded-b-xl border-dashed border-gray-300">No students enrolled yet.</div>`;

        const targetDisplay = [course.Target_Course, course.Target_Year, course.Target_Section].filter(Boolean).join(' ');
        const audienceBadge = targetDisplay 
            ? `<span class="inline-block bg-blue-100 text-blue-800 text-[10px] sm:text-xs font-bold px-2 py-1 rounded-md border border-blue-200 uppercase align-middle ml-2 sm:ml-3">${targetDisplay} Only</span>` 
            : `<span class="inline-block bg-gray-100 text-gray-600 text-[10px] sm:text-xs font-bold px-2 py-1 rounded-md border border-gray-200 uppercase align-middle ml-2 sm:ml-3">All Students</span>`;

        return `
        <!-- Top Header Bar -->
        <header class="bg-blue-700 shadow-md fixed top-0 w-full z-40">
            <div class="w-full mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl">
                <div class="flex items-center h-16">
                    <a href="#dashboard" class="text-white hover:text-blue-200 transition mr-2 sm:mr-4 p-2 -ml-2">
                        <i class="fa-solid fa-arrow-left text-xl"></i>
                    </a>
                    <div class="overflow-hidden">
                        <h1 class="text-base sm:text-lg font-bold text-white truncate">${course.CourseCode}</h1>
                        <p class="text-[11px] sm:text-xs text-blue-200 truncate">${course.CourseTitle}</p>
                    </div>
                </div>
            </div>
        </header>

        <!-- Main Content -->
        <main class="pt-20 pb-12 px-2 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full fade-in">
            <!-- Action Header -->
            <div class="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 mt-2 sm:mt-4 gap-4 px-2 sm:px-0">
                <div>
                    <h2 class="text-xl sm:text-2xl font-black text-gray-800 tracking-tight flex items-center flex-wrap">
                        Class Roster & Attendance ${audienceBadge}
                    </h2>
                    <p class="text-xs sm:text-sm text-gray-500 mt-2"><i class="fa-regular fa-clock mr-1"></i> ${course.ScheduleDay} | ${course.TimePeriod}</p>
                </div>
                
                <div class="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-3 w-full md:w-auto">
                    <button id="exportRosterBtn" data-course-id="${course.Course_ID}" class="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center w-full sm:w-auto">
                        <i class="fa-solid fa-print mr-2"></i> Print Roster
                    </button>
                    <button id="openAddStudentModalBtn" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center w-full sm:w-auto">
                        <i class="fa-solid fa-user-plus mr-2"></i> Enroll Student
                    </button>
                    <input type="date" id="attendanceDate" class="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md text-sm bg-white font-medium focus:ring-2 focus:ring-blue-500 outline-none" value="${new Date().toISOString().split('T')[0]}">
                    <button id="saveAttendanceBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center w-full sm:w-auto">
                        <i class="fa-solid fa-floppy-disk mr-2"></i> Save Attendance
                    </button>
                </div>
            </div>
            
            <div id="attendanceAlert" class="hidden mb-4 mx-2 sm:mx-0 p-3 rounded-md text-sm font-medium"></div>

            <!-- Student List Container -->
            <div class="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden mx-0 sm:mx-0">
                <div class="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                    <span class="text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-wider">
                        ${students.length} Enrolled Students
                    </span>
                    <div class="space-x-2">
                        <button type="button" id="markAllPresent" class="text-[10px] sm:text-xs font-bold text-green-600 hover:text-green-800 underline">Mark All Present</button>
                    </div>
                </div>
                <div>
                    ${students.length > 0 ? studentList : emptyState}
                </div>
            </div>
        </main>

        <!-- Manage Student Modal -->
        <div id="manageStudentModal" class="hidden fixed inset-0 z-[70] flex items-center justify-center fade-in p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeManageStudentModalBg"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-sm p-4 sm:p-6 relative z-10 scale-up">
                <div class="flex justify-between items-center mb-4 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-user-gear text-blue-600 mr-2"></i>Manage Student</h3>
                    <button id="closeManageStudentModalBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>
                <div id="manageStudentName" class="font-black text-gray-800 text-center mb-4 text-base sm:text-lg"></div>
                <input type="hidden" id="manageStudentId">
                
                <div class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Seat</label>
                            <input type="text" id="manageSeatInput" class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Group</label>
                            <input type="text" id="manageGroupInput" class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center">
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Account Status</label>
                        <select id="manageStatusSelect" class="w-full px-3 py-2 text-sm border rounded outline-none font-medium cursor-pointer transition">
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                            <option value="Suspended">Suspended</option>
                            <option value="UD">UD</option>
                            <option value="Dropped">Dropped</option>
                        </select>
                    </div>
                    
                    <div class="border-t border-gray-200 pt-4 mt-4 flex flex-col space-y-2">
                        <button type="button" id="manageResetPwdBtn" class="w-full py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded text-sm font-bold border border-red-200 transition focus:outline-none">
                            <i class="fa-solid fa-key mr-2"></i> Reset Password
                        </button>
                        <button type="button" id="manageRemoveBtn" class="w-full py-2 bg-white text-gray-500 hover:bg-red-600 hover:text-white rounded text-sm font-bold border border-gray-300 hover:border-red-600 transition focus:outline-none">
                            <i class="fa-solid fa-trash mr-2"></i> Remove from Course
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Add Student Modal -->
        <div id="addStudentModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-2 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm modal-backdrop" id="closeAddStudentModalBg"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-3xl p-4 sm:p-6 relative z-10 scale-up max-h-[95vh] sm:max-h-[90vh] flex flex-col">
                <div class="flex justify-between items-center mb-5 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-user-plus text-green-600 mr-2"></i>Manually Enroll Student</h3>
                    <button id="closeAddStudentModalBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>
                
                <div class="mb-4 flex flex-col md:flex-row gap-2">
                    <input type="text" id="studentSearchInput" placeholder="Search by Name or Student No..." class="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-gray-50">
                    <div class="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                        <select id="filterStatus" class="w-full sm:w-32 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50 font-medium">
                            <option value="Active">Active Only</option>
                            <option value="">All Statuses</option>
                            <option value="Inactive">Inactive</option>
                            <option value="Suspended">Suspended</option>
                            <option value="UD">UD</option>
                            <option value="Dropped">Dropped</option>
                        </select>
                        <select id="filterCourse" class="w-full sm:w-32 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50">
                            <option value="">Course (All)</option>
                        </select>
                        <div class="flex gap-2 w-full sm:w-auto">
                            <input type="text" id="filterYear" placeholder="Year" class="w-full sm:w-20 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50">
                            <input type="text" id="filterSection" placeholder="Section" class="w-full sm:w-24 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50">
                        </div>
                    </div>
                </div>

                <div id="unenrolledStudentsList" class="flex-1 overflow-y-auto space-y-2 min-h-[300px] bg-gray-50 p-2 rounded border border-gray-200">
                    <div class="text-center py-10 text-gray-500 text-sm"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-blue-600"></i><br>Loading students...</div>
                </div>
            </div>
        </div>
        `;
    }
};
