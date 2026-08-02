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
                    <label class="block text-sm font-medium text-gray-700">Username</label>
                    <input type="text" id="loginUsername" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
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
                        <label class="block text-sm font-medium text-gray-700">Contact Number</label>
                        <input type="text" id="regContact" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Course</label>
                        <input type="text" id="regCourse" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                    </div>
                </div>

                 <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div>
                        <label class="block text-sm font-medium text-gray-700">Year</label>
                        <input type="text" id="regYear" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Section</label>
                        <input type="text" id="regSection" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                    </div>
                </div>
                
                <button type="submit" class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 mt-4">
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
                <h1 class="text-2xl font-bold text-gray-800">Portal Dashboard</h1>
                <button id="logoutBtn" class="text-sm bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded">Logout</button>
             </div>
             <p>Welcome, <strong>${user.Name}</strong> (@${user.Username})</p>
             <div class="mt-6 grid grid-cols-2 gap-4">
                <div class="p-4 bg-gray-50 rounded border">
                    <p class="text-sm text-gray-500">Course</p>
                    <p class="font-semibold">${user.course || 'N/A'}</p>
                </div>
                <div class="p-4 bg-gray-50 rounded border">
                    <p class="text-sm text-gray-500">Year & Section</p>
                    <p class="font-semibold">${user.year || 'N/A'} - ${user.section || 'N/A'}</p>
                </div>
             </div>
        </div>
    `
};
