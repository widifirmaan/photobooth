const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders, ...extraHeaders },
    });
}

function getEnv(env, key) {
    if (env && env[key] !== undefined && env[key] !== null) return env[key];
    return process.env[key] || '';
}

async function createJWT(payload, secret) {
    const encoder = new TextEncoder();
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = btoa(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }));
    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = btoa(String.fromCharCode(...new Uint8Array(
        await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`))
    )));
    return `${header}.${body}.${sig}`;
}

async function verifyJWT(token, secret) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw', encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
        );
        const valid = await crypto.subtle.verify(
            'HMAC', key,
            new Uint8Array([...atob(parts[2])].map(c => c.charCodeAt(0))),
            encoder.encode(`${parts[0]}.${parts[1]}`)
        );
        if (!valid) return null;
        return JSON.parse(atob(parts[1]));
    } catch { return null; }
}

async function hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(password + salt),
        'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 10000, hash: 'SHA-256' },
        key, 512
    );
    return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function verifyPassword(password, hash, salt) {
    const h = await hashPassword(password, salt);
    return h === hash;
}

function generateSessionToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getAdminToken(request) {
    const auth = request.headers.get('Authorization') || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7);
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(new RegExp(`(?:^|;\\s*)admin_session=([^;]*)`));
    return match ? match[1] : null;
}

async function getSession(env, request) {
    const token = getAdminToken(request);
    if (!token) return { token: null, isRoot: false, accountId: null, username: null };

    try {
        const settings = await env.PHOTOBOX_DB.prepare('SELECT password, passwordSalt, session FROM settings WHERE id = ?').bind('root').first();
        if (settings && settings.session === token) {
            return { token, isRoot: true, accountId: null, username: 'root' };
        }

        const account = await env.PHOTOBOX_DB.prepare('SELECT id, username FROM accounts WHERE session = ?').bind(token).first();
        if (account) {
            return { token, isRoot: false, accountId: account.id, username: account.username };
        }

        return { token: null, isRoot: false, accountId: null, username: null };
    } catch {
        return { token: null, isRoot: false, accountId: null, username: null };
    }
}

async function buildAccountFilter(env, request) {
    const { searchParams } = new URL(request.url);
    const session = await getSession(env, request);
    const qAccountId = searchParams.get('accountId');

    if (qAccountId) {
        if (!session.isRoot && qAccountId !== session.accountId) {
            return session.accountId ? { accountId: session.accountId } : { publicOnly: true };
        }
        if (qAccountId === 'root') return null;
        return { accountId: qAccountId };
    }

    if (session.accountId && !session.isRoot) return { accountId: session.accountId };
    if (!session.token) return { publicOnly: true };
    return null;
}

async function getRootSettings(db) {
    const row = await db.prepare('SELECT * FROM settings WHERE id = ?').bind('root').first();
    if (!row) return null;
    const clean = { ...row };
    delete clean.password;
    delete clean.passwordSalt;
    delete clean.session;
    try { clean.slideshowImages = JSON.parse(row.slideshowImages || '[]'); } catch { clean.slideshowImages = []; }
    if (!clean.slideshowImages || clean.slideshowImages.length === 0) {
        clean.slideshowImages = [
            'https://images.unsplash.com/photo-1519741497674-611481863552?w=800&q=80',
            'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800&q=80',
            'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&q=80',
            'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80',
            'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=800&q=80',
        ];
    }
    try { clean.header = JSON.parse(row.header || '{}'); } catch { clean.header = {}; }
    try { clean.footer = JSON.parse(row.footer || '{}'); } catch { clean.footer = {}; }
    try { clean.system = JSON.parse(row.system || '{}'); } catch { clean.system = {}; }
    return clean;
}

function mapAccountSettings(account) {
    let s = {};
    try { s = JSON.parse(account.settings || '{}'); } catch { s = {}; }
    return {
        appName: s.appName || 'VelvetSnap',
        appTagline: s.appTagline || 'AI-Powered Photobooth Experience',
        heroSubtitle: s.heroSubtitle || 'Pilih frame, foto, edit, dan dapatkan hasil cetakan berkualitas tinggi dalam hitungan menit',
        logo: s.logo || '',
        cardSmallHtml: s.cardSmallHtml || '',
        cardPromoHtml: s.cardPromoHtml || '',
        slideshowImages: Array.isArray(s.slideshowImages) && s.slideshowImages.length > 0 ? s.slideshowImages : [
            'https://images.unsplash.com/photo-1519741497674-611481863552?w=800&q=80',
            'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800&q=80',
            'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&q=80',
            'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80',
            'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=800&q=80',
        ],
        header: { location: s.header?.location || 'Jakarta', navItems: s.header?.navItems || '[{"label":"Instagram","url":"https://instagram.com"},{"label":"WhatsApp","url":"https://wa.me/628123456789"},{"label":"Templates","url":"/templates"},{"label":"Studio","url":"/strips-studio"}]' },
        footer: { text: s.footer?.text || 'VelvetSnap Photobooth Platform' },
        system: { primaryColor: s.system?.primaryColor || '#262626', accentColor: s.system?.accentColor || '#C5D89D', showPreloader: s.system?.showPreloader ?? true, showStrips: s.system?.showStrips ?? true, slideshowInterval: s.system?.slideshowInterval || 3000, sessionTimer: s.system?.sessionTimer ?? 600 },
        uiTheme: s.uiTheme || 'v1',
    };
}

function normalizeTemplate(doc) {
    if (!doc) return doc;
    let td = {};
    try { td = JSON.parse(doc.templateData || '{}'); } catch { td = {}; }
    return {
        _id: doc.id,
        templateId: doc.templateId,
        templateName: doc.templateName || '',
        templateDesc: doc.templateDesc || '',
        templatePrice: doc.templatePrice ?? 0,
        templateFull: doc.templateFull || '',
        templateThumb: doc.templateThumb || '',
        templateData: {
            elements: td.elements || [],
            slotsLayout: td.slotsLayout || [],
            canvasWidth: td.canvasWidth || 1000,
            canvasHeight: td.canvasHeight || 3000,
            color: td.color || '#ffffff',
            type: td.type || 'frame',
            slots: td.slots ?? 1,
        },
        isActive: doc.isActive ?? true,
        accountId: doc.accountId || null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

function normalizeTransaction(tx) {
    if (!tx) return tx;
    let captures = [];
    try { captures = JSON.parse(tx.captures || '[]'); } catch {}
    let videos = [];
    try { videos = JSON.parse(tx.videos || '[]'); } catch {}
    return {
        _id: tx.id,
        ...tx,
        captures,
        videos,
    };
}

let schemaReady = null;
async function ensureSchema(db) {
    if (schemaReady) return schemaReady;
    schemaReady = (async () => {
        const cols = await db.prepare(`SELECT name FROM pragma_table_info('transactions')`).all();
        const hasVideos = (cols.results || []).some((c) => c.name === 'videos');
        if (!hasVideos) {
            await db.prepare(`ALTER TABLE transactions ADD COLUMN videos TEXT NOT NULL DEFAULT '[]'`).run();
        }
    })().catch((e) => { console.error('ensureSchema failed', e); schemaReady = null; });
    return schemaReady;
}

function generateId() {
    return crypto.randomUUID();
}

function getCloudinaryConfig(env) {
    const url = getEnv(env, 'CLOUDINARY_URL');
    const match = url.match(/cloudinary:\/\/(\w+):([\w-]+)@(\w+)/);
    if (match) {
        return { cloudName: match[3], apiKey: match[1], apiSecret: match[2] };
    }
    return {
        cloudName: getEnv(env, 'CLOUDINARY_CLOUD_NAME'),
        apiKey: getEnv(env, 'CLOUDINARY_API_KEY'),
        apiSecret: getEnv(env, 'CLOUDINARY_API_SECRET'),
    };
}

async function uploadToCloudinary(env, dataUri, folder, publicId, resourceType = 'image') {
    const { cloudName, apiKey, apiSecret } = getCloudinaryConfig(env);
    if (!cloudName || !apiKey || !apiSecret) {
        throw new Error('Cloudinary not configured. Set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET');
    }

    const mimeMatch = dataUri.match(/^data:([\w\/-]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : (resourceType === 'video' ? 'video/mp4' : 'image/png');
    const base64Data = dataUri.replace(/^data:[\w\/-]+;base64,/, '');
    const timestamp = Math.floor(Date.now() / 1000);
    const folderParam = folder || 'velvetsnap/templates';

    const signParams = { folder: folderParam, timestamp: timestamp.toString() };
    if (publicId) {
        signParams.public_id = publicId;
        signParams.overwrite = 'true';
        signParams.invalidate = 'true';
    }
    const toSign = Object.entries(signParams)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&') + apiSecret;
    const encoder = new TextEncoder();
    const signatureBytes = await crypto.subtle.digest('SHA-1', encoder.encode(toSign));
    const signature = Array.from(new Uint8Array(signatureBytes)).map(b => b.toString(16).padStart(2, '0')).join('');

    const formData = new FormData();
    formData.append('file', `data:${mimeType};base64,${base64Data}`);
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp.toString());
    formData.append('folder', folderParam);
    formData.append('signature', signature);
    if (publicId) {
        formData.append('public_id', publicId);
        formData.append('overwrite', 'true');
        formData.append('invalidate', 'true');
    }

    const endpoint = resourceType === 'video'
        ? `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`
        : `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
    const res = await fetch(endpoint, {
        method: 'POST',
        body: formData,
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error?.message || 'Cloudinary upload failed');
    return result.secure_url;
}

async function isBase64(str) {
    return typeof str === 'string' && /^data:[\w\/-]+;base64,/.test(str);
}

async function urlToBase64(url) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        const mime = res.headers.get('content-type') || 'image/png';
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        return `data:${mime};base64,${base64}`;
    } catch { return null; }
}

export default {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;
        const db = env.PHOTOBOX_DB;

        try { await ensureSchema(db); } catch (e) { console.error('ensureSchema error', e); }

        if (path === '/api/ping') {
            return json({ pong: true, path });
        }

        if (path === '/api/admin/login' && request.method === 'POST') return handleLogin(request, db, env);
        if (path === '/api/admin/login' && request.method === 'DELETE') return handleLogout(request, db, env);
        if (path === '/api/admin/session' && request.method === 'GET') return handleSession(env, request);
        if (path === '/api/admin/password' && request.method === 'PUT') return handleChangePassword(request, db, env);
        if (path === '/api/admin/accounts') {
            if (request.method === 'GET') return handleListAccounts(request, db, env);
            if (request.method === 'POST') return handleCreateAccount(request, db, env);
        }
        if (path.match(/^\/api\/admin\/accounts\/[^\/]+$/) && request.method === 'DELETE') return handleDeleteAccount(request, db, env);
        if (path.match(/^\/api\/admin\/accounts\/[^\/]+$/) && request.method === 'PUT') return handleResetAccountPassword(request, db, env);

        if (path === '/api/settings') {
            if (request.method === 'GET') return handleGetSettings(request, db, env);
            if (request.method === 'PUT') return handleUpdateSettings(request, db, env);
        }

        if (path === '/api/templates' && request.method === 'GET') return handleGetTemplates(request, db, env);
        if (path === '/api/templates' && request.method === 'POST') return handleCreateTemplate(request, db, env);
        if (path === '/api/templates/list' && request.method === 'GET') return handleGetTemplatesList(request, db, env);
        if (path === '/api/templates/thumbnails' && request.method === 'GET') return handleGetTemplateThumbnails(request, db, env);
        if (path === '/api/templates/reupload' && request.method === 'GET') return handleReuploadTemplates(request, db, env);

        if (path.match(/^\/api\/templates\/[^\/]+$/) && request.method === 'PUT') return handleUpdateTemplate(request, db, env);
        if (path.match(/^\/api\/templates\/[^\/]+$/) && request.method === 'DELETE') return handleDeleteTemplate(request, db, env);

        if (path === '/api/transactions' && request.method === 'POST') return handleCreateTransaction(request, db);
        if (path === '/api/transactions' && request.method === 'GET') return handleListTransactions(request, db, env);
        if (path === '/api/transactions' && request.method === 'DELETE') return handleDeleteTransaction(request, db, env);
        if (path === '/api/transactions/strips' && request.method === 'GET') return handleGetStrips(request, db, env);
        if (path === '/api/transactions/count' && request.method === 'GET') return handleGetTransactionCount(request, db, env);
        if (path === '/api/transactions/migrate-images' && (request.method === 'GET' || request.method === 'POST')) return handleMigrateImages(request, db, env);

        if (path.match(/^\/api\/transactions\/[^\/]+$/) && request.method === 'GET') return handleGetTransaction(request, db, env);
        if (path.match(/^\/api\/transactions\/[^\/]+$/) && request.method === 'PATCH') return handlePatchTransaction(request, db, env);

        if (path === '/api/midtrans/charge' && request.method === 'POST') return handleMidtransCharge(request, db, env);
        if (path === '/api/midtrans/notification' && request.method === 'POST') return handleMidtransNotification(request, db, env);
        if (path === '/api/midtrans/status' && request.method === 'GET') return handleMidtransStatus(request, db);

        if (path === '/api/doku/charge' && request.method === 'POST') return handleDokuCharge(request, db, env);
        if (path === '/api/doku/notification' && request.method === 'POST') return handleDokuNotification(request, db, env);
        if (path === '/api/doku/status' && request.method === 'GET') return handleMidtransStatus(request, db);

        if (path === '/api/upload' && request.method === 'POST') return handleUpload(request, env);

        if (path === '/api/camera/capture' && request.method === 'POST') return handleCameraCapture(request);

        if (path === '/api/image/search' && request.method === 'POST') return handleImageSearch(request, env);

        if (path === '/api/devices' && request.method === 'GET') return handleListDevices(request, db, env);
        if (path === '/api/devices' && request.method === 'POST') return handleCreateDevice(request, db, env);

        if (path === '/api/log' && request.method === 'POST') return handleLog(request);

        if (path === '/api/finance' && request.method === 'GET') return handleFinance(request, db, env);

        if (path === '/api/debug-test') {
            const results = {};
            try { results.uuid = generateId(); } catch(e) { results.uuidErr = e.message; }
            try { results.hash = await hashPassword('test', 'salt123'); } catch(e) { results.hashErr = e.message; }
            try { results.jwt = await createJWT({ test: 1 }, 'secret'); } catch(e) { results.jwtErr = e.message; }
            try { results.d1 = await db.prepare('SELECT 1 as val').all(); } catch(e) { results.d1Err = e.message; }
            if (results.d1) results.d1 = results.d1.results;
            return json(results);
        }

        return env.ASSETS.fetch(request);
    }
};

async function handleLogin(request, db, env) {
    try {
        const secure = request.url.startsWith('https://');
        const { username, password } = await request.json();
        if (!password) return json({ success: false, error: 'Password required' }, 400);

        if (!username || username === 'root') {
            let settings = await db.prepare('SELECT * FROM settings WHERE id = ?').bind('root').first();
            if (!settings) {
                await db.prepare('INSERT INTO settings (id) VALUES (?)').bind('root').run();
                settings = await db.prepare('SELECT * FROM settings WHERE id = ?').bind('root').first();
            }
            if (!settings.password) {
                const salt = generateSessionToken().slice(0, 16);
                const hash = await hashPassword('root', salt);
                await db.prepare('UPDATE settings SET password = ?, passwordSalt = ? WHERE id = ?').bind(hash, salt, 'root').run();
                settings = await db.prepare('SELECT * FROM settings WHERE id = ?').bind('root').first();
            }
            if (!settings.password || !(await verifyPassword(password, settings.password, settings.passwordSalt))) {
                return json({ success: false, error: 'Invalid credentials' }, 401);
            }
            const token = generateSessionToken();
            await db.prepare('UPDATE settings SET session = ? WHERE id = ?').bind(token, 'root').run();
            const headers = { 'Content-Type': 'application/json', ...corsHeaders };
            headers['Set-Cookie'] = `admin_session=${token}; HttpOnly; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
            return new Response(JSON.stringify({ success: true, token, isRoot: true, username: 'root' }), { status: 200, headers });
        }

        const account = await db.prepare('SELECT * FROM accounts WHERE username = ?').bind(username).first();
        if (!account) return json({ success: false, error: 'Invalid credentials' }, 401);
        if (!(await verifyPassword(password, account.password, account.passwordSalt))) {
            return json({ success: false, error: 'Invalid credentials' }, 401);
        }
        const token = generateSessionToken();
        await db.prepare('UPDATE accounts SET session = ? WHERE id = ?').bind(token, account.id).run();
        const headers = { 'Content-Type': 'application/json', ...corsHeaders };
        headers['Set-Cookie'] = `admin_session=${token}; HttpOnly; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
        return new Response(JSON.stringify({ success: true, token, isRoot: false, accountId: account.id, username: account.username }), { status: 200, headers });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleLogout(request, db, env) {
    try {
        const secure = request.url.startsWith('https://');
        const token = getAdminToken(request);
        if (token) {
            const settings = await db.prepare('SELECT session FROM settings WHERE id = ?').bind('root').first();
            if (settings && settings.session === token) {
                await db.prepare('UPDATE settings SET session = ? WHERE id = ?').bind('', 'root').run();
            }
            await db.prepare('UPDATE accounts SET session = ? WHERE session = ?').bind('', token).run();
        }
        const headers = { 'Content-Type': 'application/json', ...corsHeaders };
        headers['Set-Cookie'] = `admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
        return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleSession(env, request) {
    try {
        const session = await getSession(env, request);
        if (!session.token) return json({ success: false, error: 'No session' }, 401);
        return json({ success: true, isRoot: session.isRoot, accountId: session.accountId, username: session.username });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleChangePassword(request, db, env) {
    try {
        const { password } = await request.json();
        if (!password || password.length < 4) return json({ success: false, error: 'Password must be at least 4 characters' }, 400);
        const session = await getSession(env, request);
        if (!session.token) return json({ success: false, error: 'Unauthorized' }, 401);

        const salt = generateSessionToken().slice(0, 16);
        const hash = await hashPassword(password, salt);

        if (session.isRoot) {
            await db.prepare('UPDATE settings SET password = ?, passwordSalt = ? WHERE id = ?').bind(hash, salt, 'root').run();
        } else if (session.accountId) {
            await db.prepare('UPDATE accounts SET password = ?, passwordSalt = ? WHERE id = ?').bind(hash, salt, session.accountId).run();
        }
        return json({ success: true });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleListAccounts(request, db, env) {
    try {
        const session = await getSession(env, request);
        if (!session.isRoot) return json({ success: false, error: 'Forbidden' }, 403);
        const accounts = await db.prepare('SELECT id, username, createdAt, updatedAt FROM accounts ORDER BY createdAt DESC').all();
        return json({ success: true, data: accounts.results || [] });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleCreateAccount(request, db, env) {
    try {
        const session = await getSession(env, request);
        if (!session.isRoot) return json({ success: false, error: 'Forbidden' }, 403);
        const { username, password } = await request.json();
        if (!username || username.trim().length < 2) return json({ success: false, error: 'Username minimal 2 karakter' }, 400);
        if (!password || password.length < 4) return json({ success: false, error: 'Password minimal 4 karakter' }, 400);
        if (username === 'root') return json({ success: false, error: 'Username "root" tidak dapat digunakan' }, 400);

        const existing = await db.prepare('SELECT id FROM accounts WHERE username = ?').bind(username.trim()).first();
        if (existing) return json({ success: false, error: 'Username sudah digunakan' }, 409);

        const id = generateId();
        const salt = generateSessionToken().slice(0, 16);
        const hash = await hashPassword(password, salt);
        await db.prepare('INSERT INTO accounts (id, username, password, passwordSalt) VALUES (?, ?, ?, ?)').bind(id, username.trim(), hash, salt).run();

        return json({ success: true, data: { _id: id, username: username.trim(), createdAt: new Date().toISOString() } }, 201);
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleDeleteAccount(request, db, env) {
    try {
        const session = await getSession(env, request);
        if (!session.isRoot) return json({ success: false, error: 'Forbidden' }, 403);
        const id = request.url.split('/').pop();
        const result = await db.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();
        if (result.meta.changes === 0) return json({ success: false, error: 'Account not found' }, 404);
        return json({ success: true });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleResetAccountPassword(request, db, env) {
    try {
        const session = await getSession(env, request);
        if (!session.isRoot) return json({ success: false, error: 'Forbidden' }, 403);
        const { password } = await request.json();
        if (!password || password.length < 4) return json({ success: false, error: 'Password minimal 4 karakter' }, 400);
        const id = request.url.split('/').pop();
        const salt = generateSessionToken().slice(0, 16);
        const hash = await hashPassword(password, salt);
        const result = await db.prepare('UPDATE accounts SET password = ?, passwordSalt = ?, session = ? WHERE id = ?').bind(hash, salt, '', id).run();
        if (result.meta.changes === 0) return json({ success: false, error: 'Account not found' }, 404);
        return json({ success: true });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleGetSettings(request, db, env) {
    try {
        const { searchParams } = new URL(request.url);
        const session = await getSession(env, request);
        const qAccountId = searchParams.get('accountId');

        if (qAccountId || (session.accountId && !session.isRoot)) {
            const accountId = qAccountId || session.accountId;
            const account = await db.prepare('SELECT settings FROM accounts WHERE id = ?').bind(accountId).first();
            if (account) return json({ success: true, data: mapAccountSettings(account) }, 200, { 'Cache-Control': 'no-store' });
        }

        const settings = await getRootSettings(db);
        return json({ success: true, data: settings }, 200, { 'Cache-Control': 'no-store' });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleUpdateSettings(request, db, env) {
    try {
        const session = await getSession(env, request);
        if (session.accountId && !session.isRoot) {
            const body = await request.json();
            let existing = {};
            const row = await db.prepare('SELECT settings FROM accounts WHERE id = ?').bind(session.accountId).first();
            try { existing = JSON.parse(row.settings || '{}'); } catch {}
            const updated = { ...existing };
            for (const [key, val] of Object.entries(body)) {
                if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
                    updated[key] = { ...(updated[key] || {}), ...val };
                } else {
                    updated[key] = val;
                }
            }
            await db.prepare('UPDATE accounts SET settings = ?, updatedAt = datetime("now") WHERE id = ?').bind(JSON.stringify(updated), session.accountId).run();
            const updatedRow = await db.prepare('SELECT settings FROM accounts WHERE id = ?').bind(session.accountId).first();
            return json({ success: true, data: mapAccountSettings(updatedRow) });
        }

        if (!session.isRoot) return json({ success: false, error: 'Forbidden' }, 403);

        const body = await request.json();
        const sets = [];
        const vals = [];
        for (const [key, val] of Object.entries(body)) {
            if (['password', 'passwordSalt', 'session'].includes(key)) continue;
            let v = val;
            if (val !== null && typeof val === 'object') v = JSON.stringify(val);
            sets.push(`${key} = ?`);
            vals.push(v);
        }
        if (sets.length) {
            vals.push('root');
            await db.prepare(`UPDATE settings SET ${sets.join(', ')}, updatedAt = datetime("now") WHERE id = ?`).bind(...vals).run();
        }
        const settings = await getRootSettings(db);
        return json({ success: true, data: settings });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleGetTemplates(request, db, env) {
    try {
        const accountFilter = await buildAccountFilter(env, request);
        let query = 'SELECT * FROM templates';
        const params = [];
        if (accountFilter) {
            if (accountFilter.publicOnly) query += ' WHERE accountId IS NULL';
            else if (accountFilter.accountId) { query += ' WHERE accountId = ?'; params.push(accountFilter.accountId); }
        }
        query += ' ORDER BY createdAt DESC';
        const templates = await db.prepare(query).bind(...params).all();
        const data = (templates.results || []).map(normalizeTemplate);
        return json({ success: true, data });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleGetTemplatesList(request, db, env) {
    try {
        const accountFilter = await buildAccountFilter(env, request);
        let query = 'SELECT * FROM templates';
        const params = [];
        if (accountFilter) {
            if (accountFilter.publicOnly) query += ' WHERE accountId IS NULL';
            else if (accountFilter.accountId) { query += ' WHERE accountId = ?'; params.push(accountFilter.accountId); }
        }
        query += ' ORDER BY createdAt DESC';
        const templates = await db.prepare(query).bind(...params).all();
        const data = (templates.results || []).map(normalizeTemplate);
        // Only cache anonymous/public responses; account-scoped data must not be shared via CDN cache.
        const cacheControl = accountFilter?.publicOnly ? 'public, max-age=300' : 'no-store';
        return json({ success: true, data }, 200, { 'Cache-Control': cacheControl });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleGetTemplateThumbnails(request, db, env) {
    try {
        const accountFilter = await buildAccountFilter(env, request);
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        const filterClauses = [];
        const params = [];
        if (accountFilter) {
            if (accountFilter.publicOnly) filterClauses.push('accountId IS NULL');
            else if (accountFilter.accountId) { filterClauses.push('accountId = ?'); params.push(accountFilter.accountId); }
        }
        if (id) {
            filterClauses.push('(id = ? OR templateId = ?)');
            params.push(id, id);
        }

        let query = 'SELECT * FROM templates';
        if (filterClauses.length) query += ' WHERE ' + filterClauses.join(' AND ');
        if (!id) query += ' ORDER BY createdAt DESC';

        const templates = await db.prepare(query).bind(...params).all();
        const data = (templates.results || []).map(normalizeTemplate);
        if (id && data.length === 0) return json({ success: false, error: 'Template not found' }, 404);
        return json({ success: true, data }, id ? { 'Cache-Control': 'no-cache' } : {});
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleCreateTemplate(request, db, env) {
    try {
        const session = await getSession(env, request);
        if (!session.token) return json({ success: false, error: 'Unauthorized' }, 401);
        const body = await request.json();
        const id = generateId();
        const tid = body.templateId || id;
        const td = {
            elements: body.templateData?.elements || [],
            slotsLayout: body.templateData?.slotsLayout || [],
            canvasWidth: body.templateData?.canvasWidth || 1000,
            canvasHeight: body.templateData?.canvasHeight || 3000,
            color: body.templateData?.color || '#ffffff',
            type: body.templateData?.type || 'strip',
            slots: body.templateData?.slots ?? 1,
        };
        await db.prepare('INSERT INTO templates (id, templateId, templateName, templateDesc, templatePrice, templateFull, templateThumb, templateData, isActive, accountId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
            id, tid, body.templateName || '', body.templateDesc || '', body.templatePrice ?? 35000, body.templateFull || '', body.templateThumb || '', JSON.stringify(td), body.isActive !== undefined ? (body.isActive ? 1 : 0) : 1, session.accountId || null
        ).run();
        const doc = await db.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first();
        return json({ success: true, data: normalizeTemplate(doc) }, 201);
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleUpdateTemplate(request, db, env) {
    try {
        const tid = request.url.split('/').pop();
        const session = await getSession(env, request);
        if (!session.token) return json({ success: false, error: 'Unauthorized' }, 401);

        const existing = await db.prepare('SELECT * FROM templates WHERE id = ?').bind(tid).first();
        if (!existing) return json({ success: false, error: 'Template not found' }, 404);
        if (session.accountId && existing.accountId && existing.accountId !== session.accountId) return json({ success: false, error: 'Forbidden' }, 403);

        const body = await request.json();
        const tData = body.templateData || {};
        const elements = tData.elements || body.elements || [];
        const slotsLayout = tData.slotsLayout || body.slotsLayout || [];

        let templateFullUrl = body.templateFull || body.fullresUrl || existing.templateFull;
        let templateThumbUrl = body.templateThumb || body.thumbUrl || existing.templateThumb;

        let td = {};
        try { td = JSON.parse(existing.templateData || '{}'); } catch {}
        const folder = `velvetsnap/templates/${tid}`;

        const toUpload = [];
        if (templateFullUrl && await isBase64(templateFullUrl)) toUpload.push({ key: 'templateFull', b64: templateFullUrl });
        if (templateThumbUrl && await isBase64(templateThumbUrl)) toUpload.push({ key: 'templateThumb', b64: templateThumbUrl });

        if (body.elementImages && elements.length) {
            for (const [eid, b64] of Object.entries(body.elementImages)) {
                if (await isBase64(b64)) toUpload.push({ key: `el_${eid}`, b64 });
            }
        }

        for (const u of toUpload) {
            const url = await uploadToCloudinary(env, u.b64, folder, u.key);
            if (u.key === 'templateFull') templateFullUrl = url;
            else if (u.key === 'templateThumb') templateThumbUrl = url;
            else {
                const eid = u.key.replace('el_', '');
                const el = elements.find(e => e.id === eid);
                if (el) el.props = { ...(el.props || {}), stickerUrl: url };
            }
        }

        const newTd = {
            elements, slotsLayout,
            canvasWidth: tData.canvasWidth || body.canvasWidth || td.canvasWidth || 1000,
            canvasHeight: tData.canvasHeight || body.canvasHeight || td.canvasHeight || 3000,
            color: tData.color || body.color || td.color || '#ffffff',
            type: tData.type || body.type || td.type || 'frame',
            slots: tData.slots ?? body.slots ?? td.slots ?? 1,
        };

        await db.prepare('UPDATE templates SET templateName = ?, templateDesc = ?, templatePrice = ?, templateFull = ?, templateThumb = ?, templateData = ?, isActive = ?, updatedAt = datetime("now") WHERE id = ?').bind(
            body.templateName || body.name || existing.templateName,
            body.templateDesc ?? body.description ?? existing.templateDesc,
            body.templatePrice ?? body.price ?? existing.templatePrice,
            templateFullUrl, templateThumbUrl,
            JSON.stringify(newTd),
            body.isActive !== undefined ? (body.isActive ? 1 : 0) : existing.isActive,
            tid
        ).run();

        const doc = await db.prepare('SELECT * FROM templates WHERE id = ?').bind(tid).first();
        return json({ success: true, data: normalizeTemplate(doc) });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleDeleteTemplate(request, db, env) {
    try {
        const tid = request.url.split('/').pop();
        const session = await getSession(env, request);
        if (!session.token) return json({ success: false, error: 'Unauthorized' }, 401);

        const existing = await db.prepare('SELECT * FROM templates WHERE id = ?').bind(tid).first();
        if (!existing) return json({ success: false, error: 'Template not found' }, 404);
        if (session.accountId && existing.accountId && existing.accountId !== session.accountId) return json({ success: false, error: 'Forbidden' }, 403);

        await db.prepare('DELETE FROM templates WHERE id = ?').bind(tid).run();
        return json({ success: true });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleReuploadTemplates(request, db, env) {
    try {
        const session = await getSession(env, request);
        if (!session.token) return json({ success: false, error: 'Unauthorized' }, 401);
        const accountFilter = await buildAccountFilter(env, request);
        let query = 'SELECT * FROM templates';
        const params = [];
        if (accountFilter) {
            if (accountFilter.publicOnly) query += ' WHERE accountId IS NULL';
            else if (accountFilter.accountId) { query += ' WHERE accountId = ?'; params.push(accountFilter.accountId); }
        }
        const templates = await db.prepare(query).bind(...params).all();
        const results = [];

        for (const doc of (templates.results || [])) {
            const tid = doc.id;
            const folder = `velvetsnap/templates/${tid}`;
            let status = 'ok';
            const errors = [];

            try {
                let td = {};
                try { td = JSON.parse(doc.templateData || '{}'); } catch {}
                const els = td.elements || [];
                const updates = {};
                const updatedElements = JSON.parse(JSON.stringify(els));

                if (doc.templateFull && doc.templateFull.includes('res.cloudinary.com')) {
                    const b64 = await urlToBase64(doc.templateFull);
                    if (b64) { updates.templateFull = await uploadToCloudinary(env, b64, folder, 'templateFull'); }
                    else { errors.push('templateFull download failed'); }
                }
                if (doc.templateThumb && doc.templateThumb.includes('res.cloudinary.com')) {
                    const b64 = await urlToBase64(doc.templateThumb);
                    if (b64) { updates.templateThumb = await uploadToCloudinary(env, b64, folder, 'templateThumb'); }
                    else { errors.push('templateThumb download failed'); }
                }
                for (const el of updatedElements) {
                    const stickerUrl = el.props?.stickerUrl;
                    if (stickerUrl && stickerUrl.includes('res.cloudinary.com')) {
                        const b64 = await urlToBase64(stickerUrl);
                        if (b64) {
                            const url = await uploadToCloudinary(env, b64, folder, `el_${el.id}`);
                            el.props.stickerUrl = url;
                        } else { errors.push(`element ${el.id} download failed`); }
                    }
                }
                if (updatedElements.length) {
                    td.elements = updatedElements;
                    updates.templateData = JSON.stringify(td);
                }
                if (Object.keys(updates).length) {
                    const sets = Object.entries(updates).map(([k]) => `${k} = ?`).join(', ');
                    const vals = Object.values(updates);
                    vals.push(tid);
                    await db.prepare(`UPDATE templates SET ${sets}, updatedAt = datetime("now") WHERE id = ?`).bind(...vals).run();
                }
                if (errors.length) status = 'partial';
            } catch (e) { status = 'error'; errors.push(e.message); }

            results.push({ id: tid, name: doc.templateName || 'Untitled', status, errors: errors.length ? errors : undefined });
        }

        return json({ success: true, processed: results.length, results });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleCreateTransaction(request, db) {
    try {
        const body = await request.json();
        const { sessionId, templateId, price, status, captures, videos, finalImage, orderId, qrCodeUrl } = body;
        if (!sessionId) return json({ success: false, error: 'sessionId is required' }, 400);

        const existing = await db.prepare('SELECT id FROM transactions WHERE sessionId = ?').bind(sessionId).first();
        // Payment completion is only trusted from the Midtrans notification (server-verified).
        // The client may only self-declare PAID for explicit bypass orders, and must never
        // downgrade a transaction that the server has already marked as PAID.
        const isBypass = typeof orderId === 'string' && orderId.startsWith('BYPASS_');
        const clientStatus = status === 'PAID' && isBypass ? 'PAID' : 'PENDING';
        const effectiveStatus = existing?.status === 'PAID' ? 'PAID' : clientStatus;
        const data = {
            templateId: templateId || 't1',
            price: price || 35000,
            status: effectiveStatus,
            captures: JSON.stringify(captures || []),
            videos: JSON.stringify(videos || []),
            finalImage: finalImage || '',
            orderId: orderId || null,
            qrCodeUrl: qrCodeUrl || null,
        };

        if (existing) {
            const sets = Object.entries(data).filter(([k]) => k !== 'sessionId').map(([k]) => `${k} = ?`).join(', ');
            const vals = Object.values(data).filter((_, i) => Object.keys(data)[i] !== 'sessionId');
            vals.push(sessionId);
            await db.prepare(`UPDATE transactions SET ${sets}, updatedAt = datetime("now") WHERE sessionId = ?`).bind(...vals).run();
            const tx = await db.prepare('SELECT * FROM transactions WHERE sessionId = ?').bind(sessionId).first();
            return json({ success: true, data: normalizeTransaction(tx) }, 200);
        }

        const id = generateId();
        await db.prepare('INSERT INTO transactions (id, sessionId, templateId, price, status, captures, videos, finalImage, orderId, qrCodeUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
            id, sessionId, data.templateId, data.price, data.status, data.captures, data.videos, data.finalImage, data.orderId, data.qrCodeUrl
        ).run();
        const tx = await db.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first();
        return json({ success: true, data: normalizeTransaction(tx) }, 201);
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleListTransactions(request, db, env) {
    try {
        const { searchParams } = new URL(request.url);
        const accountFilter = await buildAccountFilter(env, request);
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '12');
        const skip = (page - 1) * limit;

        let where = '';
        const params = [];
        if (accountFilter) {
            if (accountFilter.publicOnly) where = 'WHERE accountId IS NULL';
            else if (accountFilter.accountId) { where = 'WHERE accountId = ?'; params.push(accountFilter.accountId); }
        }

        const countResult = await db.prepare(`SELECT COUNT(*) as total FROM transactions ${where}`).bind(...params).first();
        const total = countResult?.total || 0;

        params.push(limit, skip);
        const transactions = await db.prepare(`SELECT * FROM transactions ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`).bind(...params).all();

        return json({ success: true, data: (transactions.results || []).map(normalizeTransaction), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleDeleteTransaction(request, db, env) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return json({ success: false, error: 'id is required' }, 400);

        const session = await getSession(env, request);
        if (!session.token) return json({ success: false, error: 'Unauthorized' }, 401);

        const existing = await db.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first();
        if (!existing) return json({ success: false, error: 'Transaction not found' }, 404);
        if (session.accountId && existing.accountId && existing.accountId !== session.accountId) return json({ success: false, error: 'Forbidden' }, 403);

        await db.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
        return json({ success: true });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleGetTransaction(request, db, env) {
    try {
        const id = request.url.split('/').pop();
        const tx = await db.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first();
        if (!tx) return json({ success: false, error: 'Transaction not found' }, 404);

        const session = await getSession(env, request);
        // Private tenant transactions may only be read by the owning account or root.
        // Public (kiosk) transactions remain readable anonymously for download pages.
        if (tx.accountId && !(session.isRoot || session.accountId === tx.accountId)) return json({ success: false, error: 'Forbidden' }, 403);

        return json({ success: true, data: normalizeTransaction(tx) });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handlePatchTransaction(request, db, env) {
    try {
        const id = request.url.split('/').pop();
        const body = await request.json();

        const session = await getSession(env, request);
        if (!session.token) return json({ success: false, error: 'Unauthorized' }, 401);
        const existing = await db.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first();
        if (!existing) return json({ success: false, error: 'Transaction not found' }, 404);
        if (session.accountId && existing.accountId && existing.accountId !== session.accountId) return json({ success: false, error: 'Forbidden' }, 403);

        if (body.showInCarousel === true) {
            const countResult = await db.prepare('SELECT COUNT(*) as c FROM transactions WHERE showInCarousel = 1 AND id != ?').bind(id).first();
            if ((countResult?.c || 0) >= 7) return json({ success: false, error: 'Maksimal 7 strip yang dapat ditampilkan' }, 400);
        }

        await db.prepare('UPDATE transactions SET showInCarousel = ?, updatedAt = datetime("now") WHERE id = ?').bind(body.showInCarousel ? 1 : 0, id).run();
        const tx = await db.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first();
        return json({ success: true, data: normalizeTransaction(tx) });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleGetStrips(request, db, env) {
    try {
        const accountFilter = await buildAccountFilter(env, request);
        let where = "WHERE finalImage != '' AND showInCarousel = 1";
        const params = [];
        if (accountFilter) {
            if (accountFilter.publicOnly) where += ' AND accountId IS NULL';
            else if (accountFilter.accountId) { where += ' AND accountId = ?'; params.push(accountFilter.accountId); }
        }
        const transactions = await db.prepare(`SELECT id, sessionId, finalImage FROM transactions ${where} ORDER BY createdAt DESC LIMIT 7`).bind(...params).all();
        // Only cache anonymous/public responses; account-scoped data must not be shared via CDN cache.
        const cacheControl = accountFilter?.publicOnly ? 'public, max-age=60' : 'no-store';
        return json({ success: true, data: transactions.results || [] }, 200, { 'Cache-Control': cacheControl });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleGetTransactionCount(request, db, env) {
    try {
        const accountFilter = await buildAccountFilter(env, request);
        let where = '';
        const params = [];
        if (accountFilter) {
            if (accountFilter.publicOnly) where = 'WHERE accountId IS NULL';
            else if (accountFilter.accountId) { where = 'WHERE accountId = ?'; params.push(accountFilter.accountId); }
        }
        const result = await db.prepare(`SELECT COUNT(*) as total FROM transactions ${where}`).bind(...params).first();
        const cacheControl = accountFilter?.publicOnly ? 'public, max-age=300' : 'no-store';
        return json({ success: true, total: result?.total || 0 }, 200, { 'Cache-Control': cacheControl });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleMigrateImages(request, db, env) {
    try {
        const session = await getSession(env, request);
        if (!session.token) return json({ success: false, error: 'Unauthorized' }, 401);
        const allTxs = await db.prepare('SELECT * FROM transactions').all();
        let migrated = 0, failed = 0;

        for (const tx of (allTxs.results || [])) {
            const updates = {};
            let dirty = false;

            if (tx.finalImage && await isBase64(tx.finalImage)) {
                try {
                    updates.finalImage = await uploadToCloudinary(env, tx.finalImage, 'velvetsnap/final');
                    dirty = true;
                } catch { failed++; }
            }

            let captures = [];
            try { captures = JSON.parse(tx.captures || '[]'); } catch {}

            if (captures.length) {
                const b64Indices = captures.map((c, i) => isBase64(c) ? i : -1).filter(i => i >= 0);
                if (b64Indices.length) {
                    try {
                        const results = await Promise.all(b64Indices.map(i => uploadToCloudinary(env, captures[i], 'velvetsnap/captures')));
                        const newCaptures = [...captures];
                        b64Indices.forEach((i, idx) => { newCaptures[i] = results[idx]; });
                        updates.captures = JSON.stringify(newCaptures);
                        dirty = true;
                    } catch { failed++; }
                }
            }

            if (dirty) {
                const sets = Object.entries(updates).map(([k]) => `${k} = ?`).join(', ');
                const vals = Object.values(updates);
                vals.push(tx.id);
                await db.prepare(`UPDATE transactions SET ${sets}, updatedAt = datetime("now") WHERE id = ?`).bind(...vals).run();
                migrated++;
            }
        }

        return json({ success: true, migrated, failed, total: allTxs.results?.length || 0 });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleMidtransCharge(request, db, env) {
    try {
        const body = await request.json();
        const { sessionId, templateId, price, captures, videos, finalImage } = body;
        if (!sessionId || !templateId || !price) return json({ success: false, error: 'Missing required fields' }, 400);

        const orderId = `VS-${sessionId}-${Date.now()}`;

        const midtransRes = await fetch('https://app.sandbox.midtrans.com/snap/v1/transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': 'Basic ' + btoa((getEnv(env, 'MIDTRANS_SERVER_KEY') || 'SB-Mid-server-xxx') + ':'),
            },
            body: JSON.stringify({
                transaction_details: { order_id: orderId, gross_amount: price },
                credit_card: { secure: false },
                enabled_payments: ['qris'],
                expiry: { duration: 30, unit: 'minutes' },
                customer_details: { first_name: 'Photobooth', last_name: 'Customer' },
            }),
        });
        const midtransData = await midtransRes.json();

        const existing = await db.prepare('SELECT id, status FROM transactions WHERE sessionId = ?').bind(sessionId).first();

        if (existing) {
            // Never downgrade a transaction the server has already confirmed as PAID.
            const keepPaid = existing.status === 'PAID';
            await db.prepare('UPDATE transactions SET orderId = ?, price = ?, status = ?, midtransStatus = ?, qrCodeUrl = ?, updatedAt = datetime("now") WHERE sessionId = ?').bind(
                orderId, price, keepPaid ? 'PAID' : 'PENDING', keepPaid ? 'settlement' : 'pending', midtransData.redirect_url, sessionId
            ).run();
        } else {
            const id = generateId();
            await db.prepare('INSERT INTO transactions (id, sessionId, templateId, orderId, price, status, captures, videos, finalImage, midtransStatus, qrCodeUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
                id, sessionId, templateId, orderId, price, 'PENDING', JSON.stringify(captures || []), JSON.stringify(videos || []), finalImage || '', 'pending', midtransData.redirect_url
            ).run();
        }

        const tx = await db.prepare('SELECT id FROM transactions WHERE sessionId = ?').bind(sessionId).first();
        return json({
            success: true,
            data: { token: midtransData.token, redirectUrl: midtransData.redirect_url, orderId, transactionId: tx?.id },
        });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleMidtransNotification(request, db, env) {
    try {
        const body = await request.json();
        const orderId = body.order_id;
        const transactionStatus = body.transaction_status;
        const transactionId = body.transaction_id;
        const paymentType = body.payment_type;
        const fraudStatus = body.fraud_status;
        const grossAmount = body.gross_amount;
        const statusCode = body.status_code;
        const signatureKey = body.signature_key;

        if (!orderId) return json({ success: false, error: 'Missing order_id' }, 400);

        const serverKey = getEnv(env, 'MIDTRANS_SERVER_KEY') || '';
        const encoder = new TextEncoder();
        const hashBytes = await crypto.subtle.digest('SHA-512', encoder.encode(orderId + statusCode + grossAmount + serverKey));
        const computed = Array.from(new Uint8Array(hashBytes)).map(b => b.toString(16).padStart(2, '0')).join('');

        if (!serverKey) {
            console.error('Midtrans server key not configured');
            return json({ success: false, error: 'Server key not configured' }, 500);
        }

        if (computed !== signatureKey) {
            console.error('Midtrans signature mismatch:', { computed, received: signatureKey });
            return json({ success: false, error: 'Invalid signature' }, 403);
        }

        let status = 'PENDING';
        if (transactionStatus === 'settlement' || transactionStatus === 'capture') {
            if (fraudStatus === 'accept' || fraudStatus === null || fraudStatus === undefined) status = 'PAID';
        }

        const updateData = { midtransTransactionId: transactionId, midtransStatus: transactionStatus, paymentMethod: paymentType, updatedAt: new Date().toISOString() };
        if (status === 'PAID') updateData.status = 'PAID';

        const sets = Object.entries(updateData).map(([k]) => `${k} = ?`).join(', ');
        const vals = Object.values(updateData);
        vals.push(orderId);
        const result = await db.prepare(`UPDATE transactions SET ${sets} WHERE orderId = ?`).bind(...vals).run();
        // Notification can arrive before the client finishes uploading (client POST
        // happens after payment). If the row does not exist yet, create it so the
        // payment status is never lost; the client POST fills the remaining fields.
        if ((result.meta.changes ?? result.meta.changed ?? 0) === 0 && status === 'PAID') {
            const sessionId = orderId.startsWith('VS-') ? orderId.slice(3).replace(/-\d+$/, '') : '';
            await db.prepare('INSERT INTO transactions (id, sessionId, templateId, orderId, price, status, midtransTransactionId, midtransStatus, paymentMethod) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
                generateId(), sessionId, 't1', orderId, parseFloat(grossAmount) || 0, 'PAID', transactionId, transactionStatus, paymentType
            ).run();
        }

        return json({ success: true });
    } catch (e) {
        console.error('Midtrans notification error:', e);
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleMidtransStatus(request, db) {
    try {
        const { searchParams } = new URL(request.url);
        const sessionId = searchParams.get('sessionId');
        const orderId = searchParams.get('orderId');
        if (!sessionId && !orderId) return json({ success: false, error: 'Missing sessionId or orderId' }, 400);

        let tx;
        if (orderId) tx = await db.prepare('SELECT * FROM transactions WHERE orderId = ?').bind(orderId).first();
        else tx = await db.prepare('SELECT * FROM transactions WHERE sessionId = ?').bind(sessionId).first();

        if (!tx) return json({ success: false, error: 'Transaction not found' }, 404);

        return json({
            success: true,
            data: { _id: tx.id, status: tx.status, midtransStatus: tx.midtransStatus, orderId: tx.orderId, qrCodeUrl: tx.qrCodeUrl, transactionId: tx.midtransTransactionId, paymentMethod: tx.paymentMethod },
        });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

// ── DOKU QRIS ──
function getDokuConfig(env) {
    const clientId = getEnv(env, 'DOKU_CLIENT_ID') || '';
    const secretKey = getEnv(env, 'DOKU_SECRET_KEY') || '';
    const isProduction = (getEnv(env, 'DOKU_IS_PRODUCTION') || 'false') === 'true';
    const baseUrl = isProduction ? 'https://api.doku.com' : 'https://api-sandbox.doku.com';
    return { clientId, secretKey, baseUrl };
}

async function sha256Hex(str) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Base64(secret, str) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(str));
    let bin = '';
    const bytes = new Uint8Array(sig);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

// Digest component: base64-encoded SHA-256 of the raw JSON body.
async function dokuDigest(rawBody) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody));
    let bin = '';
    const bytes = new Uint8Array(digest);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

// Signature per DOKU spec: newline-separated "Name:value" components,
// HMAC-SHA256-base64 with the Secret Key, prefixed with "HMACSHA256=".
async function dokuSignature(secretKey, clientId, requestId, timestamp, requestTarget, digestB64) {
    const stringToSign =
        `Client-Id:${clientId}\n` +
        `Request-Id:${requestId}\n` +
        `Request-Timestamp:${timestamp}\n` +
        `Request-Target:${requestTarget}\n` +
        `Digest:${digestB64}`;
    return 'HMACSHA256=' + await hmacSha256Base64(secretKey, stringToSign);
}

function dokuTimestamp() {
    // DOKU expects UTC time in ISO8601 Z format, e.g. 2024-07-12T02:45:31Z
    return new Date().toISOString().slice(0, 19) + 'Z';
}

async function handleDokuCharge(request, db, env) {
    try {
        const body = await request.json();
        const { sessionId, templateId, price, captures, videos, finalImage } = body;
        if (!sessionId || !templateId || !price) return json({ success: false, error: 'Missing required fields' }, 400);

        const { clientId, secretKey, baseUrl } = getDokuConfig(env);
        if (!clientId || !secretKey) return json({ success: false, error: 'DOKU not configured. Set DOKU_CLIENT_ID and DOKU_SECRET_KEY.' }, 500);

        const invoiceNumber = `VS-${sessionId}-${Date.now()}`.slice(0, 64);
        const requestId = crypto.randomUUID();
        const timestamp = dokuTimestamp();
        const payload = JSON.stringify({
            order: { amount: price, invoice_number: invoiceNumber, currency: 'IDR' },
            payment: { payment_due_date: 60 },
        });
        const digest = await dokuDigest(payload);
        const signature = await dokuSignature(secretKey, clientId, requestId, timestamp, '/checkout/v1/payment', digest);

        // DOKU Checkout v1: returns a hosted payment page (QRIS available inside).
        const res = await fetch(baseUrl + '/checkout/v1/payment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Client-Id': clientId,
                'Request-Id': requestId,
                'Request-Timestamp': timestamp,
                'Signature': signature,
            },
            body: payload,
        });
        const data = await res.json();
        const paymentUrl = data?.response?.payment?.url;
        if (!res.ok || !paymentUrl) {
            console.error('DOKU charge failed:', JSON.stringify(data));
            return json({ success: false, error: data?.error?.message || data?.response?.payment?.status || 'DOKU charge failed' }, 502);
        }

        const existing = await db.prepare('SELECT id, status FROM transactions WHERE sessionId = ?').bind(sessionId).first();
        if (existing) {
            // Never downgrade a transaction the server has already confirmed as PAID.
            const keepPaid = existing.status === 'PAID';
            await db.prepare('UPDATE transactions SET orderId = ?, price = ?, status = ?, midtransStatus = ?, qrCodeUrl = ?, updatedAt = datetime("now") WHERE sessionId = ?').bind(
                invoiceNumber, price, keepPaid ? 'PAID' : 'PENDING', keepPaid ? 'SUCCESS' : 'STARTUP', paymentUrl, sessionId
            ).run();
        } else {
            const id = generateId();
            await db.prepare('INSERT INTO transactions (id, sessionId, templateId, orderId, price, status, captures, videos, finalImage, midtransStatus, qrCodeUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
                id, sessionId, templateId, invoiceNumber, price, 'PENDING', JSON.stringify(captures || []), JSON.stringify(videos || []), finalImage || '', 'STARTUP', paymentUrl
            ).run();
        }

        const tx = await db.prepare('SELECT id FROM transactions WHERE sessionId = ?').bind(sessionId).first();
        return json({
            success: true,
            data: { paymentUrl, orderId: invoiceNumber, transactionId: tx?.id },
        });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleDokuNotification(request, db, env) {
    try {
        const rawBody = await request.text();
        const body = JSON.parse(rawBody);
        const invoiceNumber = body?.order?.invoice_number;
        const txStatus = body?.transaction?.status;
        if (!invoiceNumber) return json({ success: false, error: 'Missing invoice_number' }, 400);

        const { clientId, secretKey } = getDokuConfig(env);
        if (!clientId || !secretKey) return json({ success: false, error: 'DOKU not configured' }, 500);
        const requestId = request.headers.get('Request-Id') || '';
        const timestamp = request.headers.get('Request-Timestamp') || '';
        const receivedSig = request.headers.get('Signature') || '';
        const digest = await dokuDigest(rawBody);
        const computed = await dokuSignature(secretKey, clientId, requestId, timestamp, '/api/doku/notification', digest);
        if (computed !== receivedSig) {
            console.error('DOKU notification signature mismatch');
            return json({ success: false, error: 'Invalid signature' }, 403);
        }

        if (txStatus !== 'SUCCESS') return json({ success: true });

        const updateData = { status: 'PAID', midtransStatus: 'SUCCESS', paymentMethod: 'qris_doku', updatedAt: new Date().toISOString() };
        const sets = Object.entries(updateData).map(([k]) => `${k} = ?`).join(', ');
        const vals = Object.values(updateData);
        vals.push(invoiceNumber);
        const result = await db.prepare(`UPDATE transactions SET ${sets} WHERE orderId = ?`).bind(...vals).run();
        // Notification can arrive before the client finishes uploading; create the row
        // so the payment status is never lost.
        if ((result.meta.changes ?? result.meta.changed ?? 0) === 0) {
            const sessionId = invoiceNumber.startsWith('VS-') ? invoiceNumber.slice(3).replace(/-\d+$/, '') : '';
            await db.prepare('INSERT INTO transactions (id, sessionId, templateId, orderId, price, status, midtransStatus, paymentMethod) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
                generateId(), sessionId, 't1', invoiceNumber, parseFloat(body?.order?.amount) || 0, 'PAID', 'SUCCESS', 'qris_doku'
            ).run();
        }

        return json({ success: true });
    } catch (e) {
        console.error('DOKU notification error:', e);
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleUpload(request, env) {
    try {
        const { dataUri, folder, publicId, resourceType } = await request.json();
        if (!dataUri || !(await isBase64(dataUri))) return json({ success: false, error: 'Invalid data URI' }, 400);

        const base64Data = dataUri.split(',')[1] || dataUri;
        const fileBytes = Math.round((base64Data.length * 3) / 4);
        const maxBytes = resourceType === 'video' ? 30 * 1024 * 1024 : 10 * 1024 * 1024;
        if (fileBytes > maxBytes) return json({ success: false, error: `File too large (max ${Math.round(maxBytes / 1024 / 1024)}MB)` }, 400);

        const mimeMatch = dataUri.match(/^data:(image|video)\/(\w+);base64,/);
        const allowedImage = ['jpeg', 'png', 'webp', 'gif'];
        const allowedVideo = ['mp4', 'webm', 'quicktime'];
        if (!mimeMatch) return json({ success: false, error: 'Invalid data URI type' }, 400);
        const kind = mimeMatch[1];
        const ext = mimeMatch[2];
        if (kind === 'image' && !allowedImage.includes(ext)) {
            return json({ success: false, error: 'Invalid image type. Supported: jpeg, png, webp, gif' }, 400);
        }
        if (kind === 'video' && !allowedVideo.includes(ext)) {
            return json({ success: false, error: 'Invalid video type. Supported: mp4, webm' }, 400);
        }

        const url = await uploadToCloudinary(env, dataUri, folder || (kind === 'video' ? 'velvetsnap/videos' : 'velvetsnap/templates'), publicId, kind);
        return json({ success: true, url });
    } catch (e) {
        const msg = e.message || String(e);
        return json({ success: false, error: msg }, 500);
    }
}

// DSLR capture requires local desktop services (gphoto2 / DigiCamControl) that
// cannot run inside the Cloudflare edge. The kiosk browser may call DigiCamControl
// directly (http://127.0.0.1:5513) when it is running locally; this endpoint exists
// so the UI receives a clear JSON error instead of a 404 page.
async function handleCameraCapture(request) {
    return json({
        success: false,
        error: 'DSLR capture unavailable from the cloud. Use the webcam, or enable DigiCamControl capture directly from the kiosk browser.',
    }, 503);
}

async function handleImageSearch(request, env) {
    try {
        const { query, page = 1 } = await request.json();
        if (!query || !query.trim()) return json({ success: false, error: 'Query is required' }, 400);

        const apiKey = getEnv(env, 'PIXABAY_API_KEY');
        if (!apiKey) return json({ success: false, error: 'Pixabay API key not configured' }, 500);

        const url = `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(query)}&image_type=all&per_page=20&page=${page}&safesearch=true`;
        const res = await fetch(url);
        const data = await res.json();

        if (!res.ok) return json({ success: false, error: data.error || 'Pixabay search failed' }, res.status);

        const results = (data.hits || []).map(item => ({
            url: item.largeImageURL, thumbnail: item.previewURL, title: item.tags, source: item.pageURL,
        }));

        return json({ success: true, data: results, totalHits: data.totalHits || 0, page });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleListDevices(request, db, env) {
    try {
        const session = await getSession(env, request);
        if (!session.token) return json({ success: false, error: 'Unauthorized' }, 401);
        const devices = await db.prepare('SELECT * FROM devices').all();
        return json({ success: true, data: devices.results || [] });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleCreateDevice(request, db, env) {
    try {
        const session = await getSession(env, request);
        if (!session.token) return json({ success: false, error: 'Unauthorized' }, 401);
        const body = await request.json();
        const id = generateId();
        await db.prepare('INSERT INTO devices (id, deviceId, name, location, status) VALUES (?, ?, ?, ?, ?)').bind(
            id, body.deviceId || id, body.name, body.location, body.status || 'OFFLINE'
        ).run();
        const device = await db.prepare('SELECT * FROM devices WHERE id = ?').bind(id).first();
        return json({ success: true, data: device }, 201);
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}

async function handleLog(request) {
    try {
        const { level = 'info', message, data } = await request.json();
        const timestamp = new Date().toISOString();
        const prefix = `[AI-Remove-BG] [${timestamp}] [${level.toUpperCase()}]`;
        if (data) console.log(prefix, message, JSON.stringify(data));
        else console.log(prefix, message);
        return json({ success: true });
    } catch (e) {
        console.error('/api/log error:', e);
        return json({ success: false });
    }
}

async function handleFinance(request, db, env) {
    try {
        const session = await getSession(env, request);
        if (!session.token) return json({ success: false, error: 'Unauthorized' }, 401);
        const accountFilter = await buildAccountFilter(env, request);
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).toISOString();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

        const paidWhere = ["status = 'PAID'"];
        const paidParams = [];
        if (accountFilter) {
            if (accountFilter.publicOnly) paidWhere.push('accountId IS NULL');
            else if (accountFilter.accountId) { paidWhere.push('accountId = ?'); paidParams.push(accountFilter.accountId); }
        }

        const todayRes = await db.prepare(`SELECT COALESCE(SUM(price),0) as total, COUNT(*) as count FROM transactions WHERE ${paidWhere.join(' AND ')} AND createdAt >= ?`).bind(...paidParams, todayStart).first();
        const weekRes = await db.prepare(`SELECT COALESCE(SUM(price),0) as total, COUNT(*) as count FROM transactions WHERE ${paidWhere.join(' AND ')} AND createdAt >= ?`).bind(...paidParams, weekStart).first();
        const monthRes = await db.prepare(`SELECT COALESCE(SUM(price),0) as total, COUNT(*) as count FROM transactions WHERE ${paidWhere.join(' AND ')} AND createdAt >= ?`).bind(...paidParams, monthStart).first();
        const allRes = await db.prepare(`SELECT COALESCE(SUM(price),0) as total, COUNT(*) as count FROM transactions WHERE ${paidWhere.join(' AND ')}`).bind(...paidParams).first();

        const dailyRevenue = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(todayStart);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const dayRes = await db.prepare(`SELECT COALESCE(SUM(price),0) as total, COUNT(*) as count FROM transactions WHERE ${paidWhere.join(' AND ')} AND date(createdAt) = ?`).bind(...paidParams, dateStr).first();
            dailyRevenue.push({
                date: dateStr,
                label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
                total: dayRes?.total || 0,
                count: dayRes?.count || 0,
            });
        }

        const templateRev = await db.prepare(`SELECT templateId, COALESCE(SUM(price),0) as total, COUNT(*) as count FROM transactions WHERE ${paidWhere.join(' AND ')} GROUP BY templateId ORDER BY total DESC`).bind(...paidParams).all();

        const monthlyRev = await db.prepare(`SELECT substr(createdAt,1,7) as month, COALESCE(SUM(price),0) as total, COUNT(*) as count FROM transactions WHERE ${paidWhere.join(' AND ')} AND createdAt >= ? GROUP BY month ORDER BY month`).bind(...paidParams, sixMonthsAgo).all();

        return json({
            success: true,
            data: {
                today: { total: todayRes?.total || 0, count: todayRes?.count || 0 },
                week: { total: weekRes?.total || 0, count: weekRes?.count || 0 },
                month: { total: monthRes?.total || 0, count: monthRes?.count || 0 },
                allTime: { total: allRes?.total || 0, count: allRes?.count || 0 },
                dailyRevenue,
                monthlyRevenue: monthlyRev.results || [],
                templateRevenue: templateRev.results || [],
            },
        });
    } catch (e) {
        return json({ success: false, error: e.message }, 500);
    }
}
