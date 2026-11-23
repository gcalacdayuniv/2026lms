// js/terms-consent.js
// The Terms and Conditions checkbox on the sign-in and registration screens (terms.html).
// The tick is remembered on this device for this version of the terms; raise the number in TERMS_KEY when the terms change in an important way.
export const TERMS_KEY = 'terms_agreed_v1';

document.addEventListener('change', (e) => {
    if (e.target.id !== 'loginTerms' && e.target.id !== 'regTerms') return;
    try { if (e.target.checked) localStorage.setItem(TERMS_KEY, '1'); else localStorage.removeItem(TERMS_KEY); } catch (err) { /* storage blocked: the box is just ticked each time */ }
});
