// js/components-auth.js
import { TERMS_KEY } from './terms-consent.js';

// Ticked again on a device where the person already agreed to this version of the terms.
const termsChecked = () => { try { return localStorage.getItem(TERMS_KEY) === '1' ? 'checked' : ''; } catch (e) { return ''; } };

export const AuthUI = {
    renderLogin: () => `
        <main id="mainContent" class="flex flex-col justify-center items-center min-h-screen p-0 sm:p-4 auth-screen">
            <div class="w-full max-w-md bg-white rounded-none sm:rounded-lg shadow-none sm:shadow-md p-6 sm:p-8 fade-in min-h-screen sm:min-h-0 flex flex-col justify-center">
                <div class="text-center mb-8">
                    <i class="fa-solid fa-graduation-cap text-4xl text-blue-600 mb-4" aria-hidden="true"></i>
                    <h1 class="text-2xl font-bold text-gray-800">Welcome Back</h1>
                    <p class="text-gray-500 text-sm">Please sign in to your account</p>
                </div>
                <form id="loginForm" class="space-y-4">
                    <div id="loginError" role="alert" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm"></div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Username, Email, Contact, or Student No.</label>
                        <input type="text" id="loginIdentifier" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Password</label>
                        <div class="relative">
                            <input type="password" id="loginPassword" autocomplete="current-password" enterkeyhint="go" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10">
                            <button type="button" id="toggleLoginPassword" aria-label="Show password" aria-pressed="false" class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-blue-600 mt-1 focus:outline-none">
                                <i class="fa-solid fa-eye" id="loginPasswordEye" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>
                    <div id="loginCodeBox" class="hidden border border-amber-200 bg-amber-50 rounded-md p-3">
                        <label for="loginInviteCode" class="block text-sm font-bold text-gray-800"><i class="fa-solid fa-key text-amber-600 mr-1.5" aria-hidden="true"></i>Class code</label>
                        <p class="text-xs text-gray-600 mb-2">Enter the code from your lecturer to activate your account and join that class, then sign in.</p>
                        <input type="text" id="loginInviteCode" maxlength="10" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="ABC234" class="block w-full px-3 py-2 bg-white border border-gray-300 rounded-md uppercase tracking-widest font-bold focus:outline-none focus:ring-2 focus:ring-blue-500">
                    </div>
                    <label class="flex items-start gap-2.5 text-sm text-gray-700 cursor-pointer min-h-[44px] py-1">
                        <input type="checkbox" id="loginTerms" required ${termsChecked()} class="mt-0.5 w-5 h-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                        <span>I have read and agree to the <a href="terms.html" target="_blank" rel="noopener" class="font-bold text-blue-600 hover:text-blue-800 underline">Terms and Conditions</a>, including the use of the camera for exam integrity.</span>
                    </label>
                    <button type="submit" id="loginBtn" class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                        Sign In
                    </button>
                    <div id="loginInfo" role="status" class="hidden bg-green-100 text-green-800 p-3 rounded text-sm"></div>
                    <button type="button" id="forgotOpenBtn" class="w-full text-center text-sm font-medium text-blue-600 hover:text-blue-800 min-h-[44px]">Forgot password?</button>
                </form>
                <div class="mt-6 text-center">
                    <p class="text-sm text-gray-600">Don't have an account? <a href="#register" class="text-blue-600 font-medium hover:text-blue-500">Register here</a></p>
                </div>
            </div>
        </main>
        ${AuthUI.renderForgotModals()}
    `,

    renderForgotModals: () => {
        const head = (id, closeId, icon, title) => `
                <div class="flex items-center gap-3 mb-4 border-b pb-3 app-page-header">
                    <h3 id="${id}" class="text-lg font-bold text-gray-800 flex-1 min-w-0"><i class="fa-solid ${icon} text-blue-600 mr-2" aria-hidden="true"></i>${title}</h3>
                    <button id="${closeId}" type="button" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i>
                        <i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>`;
        const field = (id, label, type, extra) => `
                    <div>
                        <label for="${id}" class="block text-sm font-medium text-gray-700">${label}</label>
                        <input type="${type}" id="${id}" ${extra} class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-base min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500">
                    </div>`;
        return `
        <div id="forgotModal" class="hidden fixed inset-0 z-[100] flex items-center justify-center fade-in p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="forgotTitle">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="forgotBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-md h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel app-page max-h-full sm:max-h-[92vh] overflow-y-auto flex flex-col">
                ${head('forgotTitle', 'forgotCloseBtn', 'fa-key', 'Forgot password')}
                <form id="forgotForm" class="space-y-3" novalidate>
                    <p class="text-sm text-gray-600">Enter the same details you used to register. If they all match, a new temporary password is emailed to you.</p>
                    <div id="forgotMsg" role="status" class="hidden p-3 rounded text-sm font-medium"></div>
                    ${field('fpLastName', 'Last name', 'text', 'autocomplete="family-name" enterkeyhint="next"')}
                    ${field('fpStudentNumber', 'Student number', 'text', 'autocomplete="off" enterkeyhint="next" placeholder="00-0000"')}
                    ${field('fpEmail', 'Email address', 'email', 'autocomplete="email" inputmode="email" autocapitalize="none" enterkeyhint="next"')}
                    ${field('fpContact', 'Contact number', 'tel', 'autocomplete="tel" inputmode="tel" enterkeyhint="go"')}
                    <button type="submit" id="fpSendBtn" class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-md min-h-[44px]"><i class="fa-solid fa-envelope mr-2" aria-hidden="true"></i>Email me a new password</button>
                    <div class="flex items-center gap-3 text-xs text-gray-400" aria-hidden="true"><span class="flex-1 border-t"></span>or<span class="flex-1 border-t"></span></div>
                    <button type="button" id="askLecturerOpenBtn" class="w-full border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2.5 rounded-md min-h-[44px]"><i class="fa-solid fa-chalkboard-user mr-2" aria-hidden="true"></i>Ask my lecturer to reset it</button>
                </form>
            </div>
        </div>
        <div id="lecturerResetModal" class="hidden fixed inset-0 z-[110] flex items-center justify-center fade-in p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="lecturerResetTitle">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="lecturerResetBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-md h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel app-page max-h-full sm:max-h-[92vh] overflow-y-auto flex flex-col">
                ${head('lecturerResetTitle', 'lecturerResetCloseBtn', 'fa-chalkboard-user', 'Ask my lecturer')}
                <form id="lecturerResetForm" class="space-y-3" novalidate>
                    <p class="text-sm text-gray-600">Your lecturer will be asked to reset your password and will give you a temporary one. Change it after you sign in.</p>
                    <div id="lecturerResetMsg" role="status" class="hidden p-3 rounded text-sm font-medium"></div>
                    ${field('lrIdentifier', 'Username, student number, email or contact number', 'text', 'autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go"')}
                    <button type="submit" id="lrSendBtn" class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-md min-h-[44px]">Send request to my lecturer</button>
                </form>
            </div>
        </div>`;
    },

    renderRegister: () => `
        <main id="mainContent" class="flex flex-col justify-center items-center min-h-screen p-0 sm:p-4 auth-screen">
            <div class="w-full max-w-lg bg-white rounded-none sm:rounded-lg shadow-none sm:shadow-md p-6 sm:p-8 fade-in sm:my-8 min-h-screen sm:min-h-0">
                <div class="text-center mb-8">
                    <i class="fa-solid fa-user-plus text-4xl text-green-600 mb-4" aria-hidden="true"></i>
                    <h1 class="text-2xl font-bold text-gray-800">Create Account</h1>
                    <p class="text-gray-500 text-sm">Fill in your details to register</p>
                </div>
                <form id="registerForm" class="space-y-4">
                    <div id="registerError" role="alert" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm"></div>
                    <div id="registerSuccess" role="status" class="hidden bg-green-100 text-green-700 p-3 rounded text-sm">Registration successful! Redirecting to login...</div>
                    
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
                            <input type="text" id="regGivenName" autocomplete="given-name" enterkeyhint="next" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Last Name</label>
                            <input type="text" id="regLastName" autocomplete="family-name" enterkeyhint="next" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Suffix</label>
                            <input type="text" id="regSuffix" autocomplete="honorific-suffix" enterkeyhint="next" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="e.g. Jr. (Optional)">
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Username</label>
                            <input type="text" id="regUsername" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Email</label>
                            <input type="email" id="regEmail" autocomplete="email" inputmode="email" autocapitalize="none" enterkeyhint="next" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Student Number</label>
                            <input type="text" id="regStudentNo" autocomplete="off" enterkeyhint="next" required placeholder="00-0000" maxlength="7" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 font-mono">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">Contact Number</label>
                            <input type="text" id="regContact" autocomplete="tel" inputmode="tel" enterkeyhint="next" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                        </div>
                    </div>
                    
                    <div class="mt-4">
                        <label class="block text-sm font-medium text-gray-700">Password</label>
                        <input type="password" id="regPassword" autocomplete="new-password" enterkeyhint="done" required minlength="6" class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                    </div>

                    <fieldset class="mt-5 border border-gray-200 rounded-md p-3">
                        <legend class="px-1 text-sm font-bold text-gray-800">Your program</legend>
                        <p class="text-xs text-gray-500 mb-2">The program you are enrolled in at school.</p>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label for="regPCourse" class="block text-sm font-medium text-gray-700">Program course</label>
                                <select id="regPCourse" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                                    <option value="" disabled selected>Loading courses...</option>
                                </select>
                            </div>
                            <div>
                                <label for="regPYear" class="block text-sm font-medium text-gray-700">Program year</label>
                                <select id="regPYear" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                                    <option value="" disabled selected>Select Year</option>
                                    ${[1, 2, 3, 4, 5].map(n => `<option value="${n}">${n}</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label for="regPSection" class="block text-sm font-medium text-gray-700">Program section</label>
                                <select id="regPSection" required class="mt-1 block w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500">
                                    <option value="" disabled selected>Select Section</option>
                                    ${Array.from({length: 30}, (_, i) => `<option value="${i+1}">${i+1}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                    </fieldset>
                    <div class="grid grid-cols-1 gap-4 mt-5">
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
                    
                    <div class="mt-5 border border-amber-200 bg-amber-50 rounded-md p-3">
                        <label for="regInviteCode" class="block text-sm font-bold text-gray-800"><i class="fa-solid fa-key text-amber-600 mr-1.5" aria-hidden="true"></i>Class code <span class="font-normal text-gray-500">(optional)</span></label>
                        <p class="text-xs text-gray-600 mb-2">Got a code from your lecturer? Enter it to activate your account now and join that class right away.</p>
                        <input type="text" id="regInviteCode" maxlength="10" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="ABC234" class="block w-full px-3 py-2 bg-white border border-gray-300 rounded-md uppercase tracking-widest font-bold focus:outline-none focus:ring-2 focus:ring-green-500">
                    </div>
                    <label class="flex items-start gap-2.5 text-sm text-gray-700 cursor-pointer min-h-[44px] py-1">
                        <input type="checkbox" id="regTerms" required ${termsChecked()} class="mt-0.5 w-5 h-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                        <span>I have read and agree to the <a href="terms.html" target="_blank" rel="noopener" class="font-bold text-blue-600 hover:text-blue-800 underline">Terms and Conditions</a>, including the use of the camera for exam integrity.</span>
                    </label>
                    <button type="submit" id="regSubmitBtn" class="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-700 hover:bg-green-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 mt-4">
                        Create Account
                    </button>
                </form>
                <div class="mt-6 text-center">
                    <p class="text-sm text-gray-600">Already have an account? <a href="#login" class="text-green-700 font-medium hover:text-green-800">Sign in here</a></p>
                </div>
            </div>
        </main>
    `
};
