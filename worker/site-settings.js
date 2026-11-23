// worker/site-settings.js
// Site-wide settings an Admin can change. Today: the site icon (favicon), kept as a small PNG data URL in D1.
//   GET  /api/site-icon        public (the icon is needed before anyone signs in)  -> { icon: 'data:image/png;base64,...' | null }
//   POST /api/site-icon        Admins only  { icon: 'data:image/png;base64,...' }  or { icon: null } to go back to the default
import { json } from './http.js';

const ICON_MAX = 120000;                       // characters of the data URL (a 192 x 192 PNG is about 10-40 KB)
const ICON_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

const ensureSiteSettings = async (env) => {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS Site_Settings (Setting_Key TEXT PRIMARY KEY, Setting_Value TEXT, Updated_At TEXT, Updated_By TEXT)').run();
};

export async function handleSiteSettings(request, env, path, url, corsHeaders, caller) {
    if (path !== '/api/site-icon') return null;
    await ensureSiteSettings(env);
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
