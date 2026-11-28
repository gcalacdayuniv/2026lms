// worker/site-settings.js
// Site-wide settings an Admin can change. Today: the site icon (favicon), kept as a small PNG data URL in D1.
//   GET  /api/site-icon        public (the icon is needed before anyone signs in)  -> { icon: 'data:image/png;base64,...' | null }
//   POST /api/site-icon        Admins only  { icon: 'data:image/png;base64,...' }  or { icon: null } to go back to the default
import { json } from './http.js';

const ICON_MAX = 450000;                       // characters of the data URL (a 512 x 512 PNG is about 20-250 KB)
const ICON_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

const ensureSiteSettings = async (env) => {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS Site_Settings (Setting_Key TEXT PRIMARY KEY, Setting_Value TEXT, Updated_At TEXT, Updated_By TEXT)').run();
};

export async function handleSiteSettings(request, env, path, url, corsHeaders, caller) {
    if (path !== '/api/site-icon' && path !== '/api/site-icon.png') return null;
    await ensureSiteSettings(env);
    // The icon as a real picture file: the one address used by the browser tab, the Home Screen icon, the Android install
    // manifest and link previews (they cannot run JavaScript). No icon saved yet -> the built-in icon on the site.
    if (path === '/api/site-icon.png') {
        if (request.method !== 'GET') return null;
        const row = await env.DB.prepare("SELECT Setting_Value FROM Site_Settings WHERE Setting_Key = 'site_icon'").first();
        const m = row && row.Setting_Value ? /^data:image\/png;base64,(.+)$/.exec(row.Setting_Value) : null;
        const headers = { ...corsHeaders, 'Cache-Control': 'public, max-age=300', 'Cross-Origin-Resource-Policy': 'cross-origin' };
        if (!m) {
            const site = String(env.ALLOWED_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean)[0];
            return site ? new Response(null, { status: 302, headers: { ...headers, Location: `${site.replace(/\/$/, '')}/icons/icon-512.png` } }) : new Response('No icon', { status: 404, headers });
        }
        const bin = atob(m[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Response(bytes, { status: 200, headers: { ...headers, 'Content-Type': 'image/png' } });
    }
    if (request.method === 'GET') {
        const row = await env.DB.prepare("SELECT Setting_Value, Updated_At FROM Site_Settings WHERE Setting_Key = 'site_icon'").first();
        return json(corsHeaders, { success: true, icon: row && row.Setting_Value ? row.Setting_Value : null, updatedAt: row ? row.Updated_At : null });
    }
    if (request.method !== 'POST') return null;
    if (caller && !caller.admin) return json(corsHeaders, { error: 'Only an Admin can change the site icon.' }, 403);
    const body = await request.json();
    const icon = body.icon === null ? null : String(body.icon || '');
    if (icon !== null && (!ICON_RE.test(icon) || icon.length > ICON_MAX)) return json(corsHeaders, { error: 'The icon must be a PNG picture, small enough to be a site icon.' }, 400);
    if (icon === null) await env.DB.prepare("DELETE FROM Site_Settings WHERE Setting_Key = 'site_icon'").run();
    else await env.DB.prepare("INSERT INTO Site_Settings (Setting_Key, Setting_Value, Updated_At, Updated_By) VALUES ('site_icon', ?, ?, ?) ON CONFLICT(Setting_Key) DO UPDATE SET Setting_Value = excluded.Setting_Value, Updated_At = excluded.Updated_At, Updated_By = excluded.Updated_By")
        .bind(icon, new Date().toISOString(), caller ? caller.id : null).run();
    return json(corsHeaders, { success: true, icon });
}
