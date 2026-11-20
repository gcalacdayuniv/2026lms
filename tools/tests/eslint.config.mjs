// Catches typos and missing imports (no-undef) in the Worker after a file is split or edited. Used by run-tests.sh.
const g = (names) => Object.fromEntries(names.split(' ').map(n => [n, 'readonly']));
export default [{
    files: ['worker/**/*.js'],
    languageOptions: {
        ecmaVersion: 2023, sourceType: 'module',
        globals: g('Response Request Headers fetch crypto TextEncoder TextDecoder URL URLSearchParams console btoa atob setTimeout clearTimeout Date Math JSON Promise Uint8Array ArrayBuffer Blob FormData AbortController FixedLengthStream ReadableStream WritableStream TransformStream')
    },
    rules: { 'no-undef': 'error' }
}];
