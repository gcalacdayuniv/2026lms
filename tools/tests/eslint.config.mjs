// Catches typos and missing imports (no-undef) in the Worker after a file is split or edited. Used by run-tests.sh.
const g = (names) => Object.fromEntries(names.split(' ').map(n => [n, 'readonly']));
export default [{
    files: ['worker/**/*.js'],
    languageOptions: {
        ecmaVersion: 2023, sourceType: 'module',
        globals: g('Response Request Headers fetch crypto TextEncoder TextDecoder URL URLSearchParams console btoa atob setTimeout clearTimeout Date Math JSON Promise Uint8Array ArrayBuffer Blob FormData AbortController FixedLengthStream ReadableStream WritableStream TransformStream')
    },
    rules: { 'no-undef': 'error' }
},{
    files: ['js/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: g('window document navigator localStorage sessionStorage location history console fetch setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame URL URLSearchParams FormData Blob File FileReader Image Audio Intl Date Math JSON Promise Uint8Array ArrayBuffer Event CustomEvent MutationObserver IntersectionObserver ResizeObserver AbortController crypto atob btoa TextEncoder TextDecoder performance alert confirm prompt getComputedStyle matchMedia indexedDB caches Notification Option DOMParser XMLHttpRequest Worker WebSocket speechSynthesis SpeechSynthesisUtterance MediaRecorder CSS HTMLElement Element Node Response Request Headers BroadcastChannel queueMicrotask structuredClone screen innerWidth innerHeight scrollTo open print XLSX Chart QRCode jsQR html2canvas jspdf pdfjsLib createImageBitmap') },
    rules: { 'no-undef': 'error' }
}];
