// js/theme-boot.js
// Runs in the <head> before the page is drawn, so a saved dark (or phone-wide dark) appearance shows at once with no white flash.
// Kept as a plain (non-module) file: a module would run too late. Full theme logic is in js/theme.js.
try { var t = localStorage.getItem("theme"); if (t === "dark" || (t !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.setAttribute("data-theme", "dark"); } catch (e) {}
