// js/components.js
export const Components = {
    renderLogin: () => `
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
    `,

    renderRegister: () => `
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
                        <img id="avatarPreview" class="hidden w-24 h-24 rounded-full object-cover border-2 border-green-500 shadow-sm" />
                    </div>
                    <div class="flex justify-center space-x-3">
                        <button type="button" id="btnCamera" class="px-4 py-2 bg-gray-100 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-200 focus:outline-none">
                            <i class="fa-solid fa-camera mr-2"></i> Camera
                        </button>
                        <button type="button" id="btnFile" class="px-4 py-2 bg-gray-100 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-200 focus:outline-none">
                            <i class="fa-solid fa-upload mr-2"></i> File
                        </button>
                    </div>
                    <!-- capture="camera" forces the hardware camera directly on mobile iOS/Android -->
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
                        <input type="text" id="regCourse" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
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
    `,

    renderDashboard: (user) => `
        <div class="w-full max-w-4xl bg-white rounded-lg shadow-md p-8 fade-in">
             <div class="flex justify-between items-center border-b pb-4 mb-4">
                <div class="flex items-center space-x-4">
                    ${user.Avatar ? `<img src="${user.Avatar}" class="w-12 h-12 rounded-full object-cover border border-gray-300" />` : '<i class="fa-solid fa-circle-user text-4xl text-gray-400"></i>'}
                    <h1 class="text-2xl font-bold text-gray-800">Portal Dashboard</h1>
                </div>
                <button id="logoutBtn" class="text-sm bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded">Logout</button>
             </div>
             <p>Welcome, <strong>${user.Name}</strong> (@${user.Username})</p>
             <p class="text-sm mt-2">Status: <span class="font-semibold ${user.account_status === 'Active' ? 'text-green-600' : 'text-red-600'}">${user.account_status}</span></p>
             <div class="mt-6 grid grid-cols-2 gap-4">
                <div class="p-4 bg-gray-50 rounded border">
                    <p class="text-sm text-gray-500">Student Number</p>
                    <p class="font-semibold">${user.Student_Number || 'N/A'}</p>
                </div>
                <div class="p-4 bg-gray-50 rounded border">
                    <p class="text-sm text-gray-500">Course / Year / Section</p>
                    <p class="font-semibold">${user.course || 'N/A'} - ${user.year || 'N/A'} - ${user.section || 'N/A'}</p>
                </div>
             </div>
        </div>
    `
};
