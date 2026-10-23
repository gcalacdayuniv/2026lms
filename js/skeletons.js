// js/skeletons.js
// Gray placeholder blocks shown while data loads. Output is static markup only
// (no user data), so it is safe to assign to innerHTML.

// Radius comes from a Tailwind utility (not skeleton CSS) so `rounded-full` always wins.
const b = (cls) => `<div class="skeleton rounded ${cls}"></div>`;

// Screen readers hear the label once; the decorative blocks are hidden from them.
const live = (label, inner) =>
    `<div role="status"><span class="sr-only">${label}</span><div aria-hidden="true">${inner}</div></div>`;

const times = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join('');

const courseCard = () => `
    <div class="p-5 border rounded-xl bg-white shadow-sm">
        <div class="flex justify-between items-start mb-3">${b('h-6 w-24')}${b('h-5 w-20')}</div>
        ${b('h-4 w-3/4 mb-4')}
        ${b('h-7 w-44')}
    </div>`;

const rosterRow = () => `
    <div class="p-4 border-b border-gray-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div class="flex items-center gap-3 flex-1 min-w-0">
            ${b('w-12 h-12 rounded-full flex-shrink-0')}
            <div class="space-y-2 flex-1">
                ${b('h-3.5 w-40 max-w-full')}
                ${b('h-2.5 w-56 max-w-full')}
            </div>
        </div>
        <div class="flex items-center gap-2">
            ${b('h-8 w-14')}
            ${b('h-8 w-16')}${b('h-8 w-14')}${b('h-8 w-16')}${b('h-8 w-14')}
        </div>
    </div>`;

const summaryRow = () => `
    <tr class="border-b border-gray-100">
        <td class="px-1 py-3 w-12">${b('h-3 w-5 mx-auto')}</td>
        <td class="px-3 py-3 min-w-[220px]">
            <div class="flex items-center gap-2">
                ${b('w-10 h-10 rounded-full flex-shrink-0')}
                <div class="space-y-1.5">${b('h-3 w-32')}${b('h-2.5 w-20')}</div>
            </div>
        </td>
        ${times(8, (i) => `<td class="px-3 py-3">${b(`h-3 ${i % 3 === 0 ? 'w-24' : 'w-14'} mx-auto`)}</td>`)}
    </tr>`;

export const Skeleton = {
    // Grid of course-card placeholders.
    courseCards: (count = 6, cols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3') =>
        `<div class="grid ${cols} gap-5">${times(count, courseCard)}</div>`,

    // Whole dashboard body (matches the lecturer / student layouts).
    dashboard: (role) => {
        if (String(role || '').toLowerCase() === 'lecturer') {
            return live('Loading courses…', `
                <div class="max-w-5xl mx-auto">
                    <div class="flex items-center justify-between gap-3 mb-6">${b('h-8 w-56')}${b('h-10 w-32')}</div>
                    ${Skeleton.courseCards(6)}
                </div>`);
        }
        return live('Loading courses…', `
            <div class="space-y-12">
                <section>${b('h-8 w-60 mb-6')}${Skeleton.courseCards(3)}</section>
                <section>${b('h-8 w-52 mb-6')}${Skeleton.courseCards(2, 'grid-cols-1 md:grid-cols-2')}</section>
            </div>`);
    },

    rosterRows: (count = 8) => times(count, rosterRow),

    // Full class screen: header, title, toolbar and roster rows.
    classScreen: () => live('Loading class…', `
        <header class="bg-blue-700 shadow-md fixed top-0 w-full z-40">
            <div class="w-full mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl">
                <div class="flex items-center h-16 gap-4">
                    <i class="fa-solid fa-arrow-left text-xl text-blue-300"></i>
                    <div class="space-y-1.5">${b('h-4 w-24 skeleton-dark')}${b('h-3 w-40 skeleton-dark')}</div>
                </div>
            </div>
        </header>
        <main class="pt-20 pb-12 px-2 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full">
            <div class="mb-4 mt-2 sm:mt-4 px-2 sm:px-0">${b('h-7 w-72 max-w-full mb-3')}${b('h-4 w-44')}</div>
            <div class="mb-4 px-2 sm:px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg shadow-sm flex items-center gap-2">
                ${b('h-9 flex-1 sm:flex-none sm:w-40')}${b('h-9 w-24 ml-auto')}${b('h-9 w-20')}
            </div>
            <div class="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden">
                <div class="bg-gray-50 px-4 py-3 border-b border-gray-200">${b('h-3 w-32')}</div>
                ${times(8, rosterRow)}
            </div>
        </main>`),

    // Table body placeholder for the class summary modal.
    summaryTable: (rows = 10) => `
        <div class="overflow-hidden flex-1 border border-gray-200 rounded-lg bg-white" aria-hidden="true">
            <div class="bg-gray-200 h-9"></div>
            <table class="w-full"><tbody>${times(rows, summaryRow)}</tbody></table>
        </div>`
};
