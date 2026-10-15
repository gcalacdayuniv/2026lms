// js/components-auth.js
import { ExamUI } from './components-exam.js';

export const AuthUI = {
    renderLogin: () => `
        <div class="flex flex-col justify-center items-center min-h-screen p-4 gap-6">
            <div class="w-full max-w-md bg-white rounded-lg shadow-md p-6 sm:p-8 fade-in border border-gray-200">
                <div class="text-center mb-6">
                    <i class="fa-solid fa-graduation-cap text-4xl text-blue-600 mb-3"></i>
                    <h2 class="text-2xl font-bold text-gray-800">Welcome Back</h2>
                    <p class="text-gray-500 text-sm">Please sign in to your account</p>
                </div>
                <form id="loginForm" class="space-y-4">
                    <div id="loginError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm font-bold" role="alert" aria-live="assertive"></div>
                    <div>
                        <label for="loginIdentifier" class="block text-sm font-medium text-gray-700">Username, Email, Contact, or Student No.</label>
                        <input type="text" id="loginIdentifier" required aria-label="Username, Email, Contact, or Student Number" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                    </div>
                    <div>
                        <label for="loginPassword" class="block text-sm font-medium text-gray-700">Password</label>
                        <div class="relative">
                            <input type="password" id="loginPassword" required aria-label="Password" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10">
                            <button type="button" id="toggleLoginPassword" aria-label="Toggle Password Visibility" class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-blue-600 mt-1 focus:outline-none">
                                <i class="fa-solid fa-eye" id="loginPasswordEye"></i>
                            </button>
                        </div>
                    </div>
                    <button type="submit" id="loginBtn" class="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                        Sign In to Dashboard
                    </button>
                </form>

                <!-- Accessible Exam Entry Section on Login Screen -->
                <div class="mt-6 pt-6 border-t-2 border-indigo-100">
                    <div class="bg-indigo-950 text-white rounded-xl p-4 shadow-md border-2 border-yellow-400">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-xs font-black uppercase tracking-wider text-yellow-300 flex items-center">
                                <i class="fa-solid fa-universal-access text-lg mr-2"></i> Accessible Exam Portal
                            </span>
                            <button type="button" id="readLoginScreenBtn" class="px-2.5 py-1 bg-yellow-400 text-gray-900 hover:bg-yellow-300 rounded text-xs font-black transition focus:outline-none focus:ring-2 focus:ring-white" aria-label="Read instructions aloud">
                                <i class="fa-solid fa-volume-high mr-1"></i> Read Aloud
                            </button>
                        </div>
                        <p class="text-xs text-indigo-100 mb-3 leading-relaxed">
                            Enter your Student Number or Username and Password above, then press the button below to load and take your assigned class exam with voice read-aloud.
                        </p>
                        <button type="button" id="enterExamLoginBtn" class="w-full py-3 px-4 bg-yellow-400 hover:bg-yellow-300 text-gray-950 font-black rounded-lg shadow text-sm transition flex items-center justify-center focus:outline-none focus:ring-4 focus:ring-yellow-200">
                            <i class="fa-solid fa-headphones Simple mr-2 text-base"></i> Enter Assigned Exam
                        </button>
                        <div id="accessibleExamPortalList" class="hidden mt-4 pt-3 border-t border-indigo-800 space-y-2" aria-live="polite"></div>
                    </div>
                </div>

                <div class="mt-6 text-center">
                    <p class="text-sm text-gray-600">Don't have an account? <a href="#register" class="text-blue-600 font-medium hover:text-blue-500">Register here</a></p>
                </div>
            </div>
        </div>
        ${ExamUI.renderAccessibleExamOverlay ? ExamUI.renderAccessibleExamOverlay() : ''}
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
                            <label class="block text-sm font-medium text-gray-700">Eye Condition / Accessibility</label>
                            <select id="regEyeCondition" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                                <option value="" disabled selected>Select Condition</option>
                                <option value="No Eye Condition">No Eye Condition</option>
                                <option value="Near Sighted">Near Sighted</option>
                                <option value="Far Sighted">Far Sighted</option>
                                <option value="Legally Blind">Legally Blind</option>
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
    `
};
