// js/components.js
export const Components = {
    LoginView: () => `
        <div class="bg-white p-8 rounded-xl shadow-lg w-full max-w-sm">
            <h2 class="text-2xl font-bold text-center mb-6 text-slate-800">Portal Login</h2>
            <form id="login-form" class="space-y-4">
                <div>
                    <label class="block text-sm font-semibold text-slate-700">Username</label>
                    <input type="text" id="login-username" required class="mt-1 block w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                    <label class="block text-sm font-semibold text-slate-700">Password</label>
                    <input type="password" id="login-password" required class="mt-1 block w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                <button type="submit" class="w-full flex justify-center py-2 px-4 rounded-lg shadow-sm text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 mt-2">
                    Sign In
                </button>
            </form>
            <p class="mt-6 text-center text-sm text-slate-500">
                No account yet? <a href="#register" class="text-blue-600 hover:text-blue-700 font-semibold">Register here</a>
            </p>
        </div>
    `,
    RegisterView: () => `
        <div class="bg-white p-8 rounded-xl shadow-lg w-full max-w-sm">
            <h2 class="text-2xl font-bold text-center mb-6 text-slate-800">Create Account</h2>
            <form id="register-form" class="space-y-4">
                <div>
                    <label class="block text-sm font-semibold text-slate-700">Full Name</label>
                    <input type="text" id="reg-name" required class="mt-1 block w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                    <label class="block text-sm font-semibold text-slate-700">Email Address</label>
                    <input type="email" id="reg-email" required class="mt-1 block w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                    <label class="block text-sm font-semibold text-slate-700">Username</label>
                    <input type="text" id="reg-username" required class="mt-1 block w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                    <label class="block text-sm font-semibold text-slate-700">Password</label>
                    <input type="password" id="reg-password" required class="mt-1 block w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                <button type="submit" class="w-full flex justify-center py-2 px-4 rounded-lg shadow-sm text-sm font-bold text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 mt-2">
                    Register
                </button>
            </form>
            <p class="mt-6 text-center text-sm text-slate-500">
                Already registered? <a href="#login" class="text-blue-600 hover:text-blue-700 font-semibold">Login here</a>
            </p>
        </div>
    `,
    DashboardView: () => `
        <div class="bg-white p-8 rounded-xl shadow-lg w-full max-w-4xl text-center">
            <h1 class="text-3xl font-bold text-slate-800 mb-2">Dashboard</h1>
            <p id="dashboard-welcome" class="text-slate-600 mb-8"></p>
            <button id="logout-btn" class="py-2 px-6 rounded-lg shadow-sm text-sm font-bold text-white bg-red-500 hover:bg-red-600 focus:outline-none">
                Log Out
            </button>
        </div>
    `
};
