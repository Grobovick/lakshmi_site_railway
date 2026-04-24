require('dotenv').config();
const express = require('express');
const path = require('path');
const fsPromises = require('fs/promises');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || DEFAULT_DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'lakshmi.sqlite');
const COOKIE_NAME = 'lakshmi_admin';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'change_this_cookie_secret';
const ACTIVE_STATUSES = ['new', 'in_progress', 'done', 'archived'];
const ALL_STATUSES = [...ACTIVE_STATUSES, 'deleted'];

app.use(express.json({ limit: '300kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(PUBLIC_DIR));

let db;

function sanitize(value, maxLength = 2000) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

async function ensureStorage() {
  await fsPromises.mkdir(DATA_DIR, { recursive: true });
}

function columnExists(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function initDb() {
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      service TEXT NOT NULL,
      message TEXT DEFAULT '',
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      manager_note TEXT DEFAULT '',
      email_sent INTEGER NOT NULL DEFAULT 0,
      telegram_sent INTEGER NOT NULL DEFAULT 0
    );
  `);

  if (!columnExists('leads', 'deleted_at')) {
    db.exec(`ALTER TABLE leads ADD COLUMN deleted_at TEXT DEFAULT NULL;`);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_deleted_at ON leads(deleted_at);
  `);
}

function validateLead(payload) {
  const name = sanitize(payload.name, 120);
  const phone = sanitize(payload.phone, 40);
  const service = sanitize(payload.service, 120);
  const message = sanitize(payload.message, 2000);
  const website = sanitize(payload.website, 200);
  const consent = sanitize(payload.consent, 10);

  if (website) {
    return { ok: false, message: 'Заявка отклонена системой антиспама.' };
  }
  if (!name || name.length < 2) {
    return { ok: false, message: 'Укажите имя.' };
  }
  if (!phone || phone.length < 6) {
    return { ok: false, message: 'Укажите телефон для связи.' };
  }
  if (!service) {
    return { ok: false, message: 'Выберите услугу.' };
  }
  if (consent !== 'yes') {
    return { ok: false, message: 'Нужно согласие на обработку персональных данных.' };
  }

  return {
    ok: true,
    lead: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      name,
      phone,
      service,
      message,
      source: 'Главная страница сайта',
      status: 'new',
      managerNote: '',
    },
  };
}

function normalizeLead(row) {
  return row
    ? {
        ...row,
        email_sent: Boolean(row.email_sent),
        telegram_sent: Boolean(row.telegram_sent),
        is_deleted: row.status === 'deleted' || Boolean(row.deleted_at),
      }
    : null;
}

function saveLead(lead, emailSent, telegramSent) {
  const stmt = db.prepare(`
    INSERT INTO leads (
      id, created_at, name, phone, service, message, source, status, manager_note, email_sent, telegram_sent, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    lead.id,
    lead.createdAt,
    lead.name,
    lead.phone,
    lead.service,
    lead.message,
    lead.source,
    lead.status,
    lead.managerNote,
    emailSent ? 1 : 0,
    telegramSent ? 1 : 0,
    null,
  );
}

function listLeads(status = 'all') {
  let sql = 'SELECT * FROM leads';
  const params = [];

  if (status === 'all') {
    sql += ` WHERE status != 'deleted'`;
  } else if (status === 'deleted') {
    sql += ` WHERE status = 'deleted'`;
  } else if (ALL_STATUSES.includes(status)) {
    sql += ' WHERE status = ?';
    params.push(status);
  } else {
    sql += ` WHERE status != 'deleted'`;
  }

  sql += ' ORDER BY datetime(created_at) DESC';
  const stmt = db.prepare(sql);
  return stmt.all(...params).map(normalizeLead);
}

function getLeadById(id) {
  const stmt = db.prepare('SELECT * FROM leads WHERE id = ? LIMIT 1');
  return normalizeLead(stmt.get(id));
}

function updateLead(id, status, managerNote) {
  const normalizedStatus = status === 'deleted' ? 'deleted' : status;
  const deletedAt = normalizedStatus === 'deleted' ? new Date().toISOString() : null;
  const stmt = db.prepare(`
    UPDATE leads
    SET status = ?, manager_note = ?, deleted_at = ?
    WHERE id = ?
  `);
  stmt.run(normalizedStatus, managerNote, deletedAt, id);
  return getLeadById(id);
}

function softDeleteLead(id) {
  const stmt = db.prepare(`
    UPDATE leads
    SET status = 'deleted', deleted_at = ?
    WHERE id = ?
  `);
  stmt.run(new Date().toISOString(), id);
  return getLeadById(id);
}

function restoreLead(id) {
  const stmt = db.prepare(`
    UPDATE leads
    SET status = 'archived', deleted_at = NULL
    WHERE id = ?
  `);
  stmt.run(id);
  return getLeadById(id);
}

function hardDeleteLead(id) {
  const stmt = db.prepare('DELETE FROM leads WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

function getStats() {
  const countFor = (status) => db.prepare('SELECT COUNT(*) as count FROM leads WHERE status = ?').get(status).count;
  return {
    all: db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status != 'deleted'`).get().count,
    new: countFor('new'),
    in_progress: countFor('in_progress'),
    done: countFor('done'),
    archived: countFor('archived'),
    deleted: countFor('deleted'),
  };
}

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE === 'true',
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

async function sendLeadEmail(lead) {
  const transporter = getTransporter();
  const to = process.env.LEADS_TO;
  if (!transporter || !to) {
    return { sent: false, reason: 'SMTP не настроен' };
  }

  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const localDate = new Date(lead.createdAt).toLocaleString('ru-RU');
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#2b1c18;">
      <h2 style="margin:0 0 12px;color:#4D1812;">Новая заявка с сайта «Лакшми»</h2>
      <p><strong>Источник:</strong> ${lead.source}</p>
      <p><strong>Дата:</strong> ${localDate}</p>
      <p><strong>Имя:</strong> ${lead.name}</p>
      <p><strong>Телефон:</strong> ${lead.phone}</p>
      <p><strong>Услуга:</strong> ${lead.service}</p>
      <p><strong>Комментарий:</strong><br>${(lead.message || 'Не указан').replace(/\n/g, '<br>')}</p>
      <p style="margin-top:16px;">Админка: <a href="${process.env.SITE_URL || 'http://localhost:' + PORT}/admin/login">открыть список заявок</a></p>
    </div>
  `;

  await transporter.sendMail({
    from,
    to,
    subject: `Новая заявка с сайта Лакшми — ${lead.service}`,
    replyTo: from,
    html,
    text: [
      'Новая заявка с сайта «Лакшми»',
      `Источник: ${lead.source}`,
      `Дата: ${localDate}`,
      `Имя: ${lead.name}`,
      `Телефон: ${lead.phone}`,
      `Услуга: ${lead.service}`,
      `Комментарий: ${lead.message || 'Не указан'}`,
    ].join('\n'),
  });

  return { sent: true };
}

async function sendTelegramMessage(lead) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!token || chatIds.length === 0) {
    return { sent: false, reason: 'Telegram не настроен' };
  }

  const localDate = new Date(lead.createdAt).toLocaleString('ru-RU');
  const text = [
    '🔔 Новая заявка с сайта «Лакшми»',
    '',
    `Имя: ${lead.name}`,
    `Телефон: ${lead.phone}`,
    `Услуга: ${lead.service}`,
    `Дата: ${localDate}`,
    `Источник: ${lead.source}`,
    '',
    `Комментарий: ${lead.message || 'Не указан'}`,
  ].join('\n');

  for (const chatId of chatIds) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      throw new Error(result.description || 'Ошибка отправки в Telegram');
    }
  }

  return { sent: true };
}

function signAdminToken(login) {
  const payload = `${login}|${Date.now()}`;
  const signature = crypto.createHmac('sha256', COOKIE_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}|${signature}`).toString('base64url');
}

function verifyAdminToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [login, issuedAt, signature] = decoded.split('|');
    if (!login || !issuedAt || !signature) return false;
    const expected = crypto.createHmac('sha256', COOKIE_SECRET).update(`${login}|${issuedAt}`).digest('hex');
    return login === ADMIN_LOGIN && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const result = {};
  header.split(';').forEach((part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return;
    result[key] = decodeURIComponent(rest.join('='));
  });
  return result;
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token || !verifyAdminToken(token)) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ ok: false, message: 'Требуется вход в админ-панель.' });
    }
    return res.redirect('/admin/login');
  }
  return next();
}

app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'lakshmi_landing_restyled.html'));
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get('/admin', requireAdmin, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html'));
});

app.get('/admin/login', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin', 'login.html'));
});

app.get('/api/admin/me', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  return res.json({ ok: !!(token && verifyAdminToken(token)) });
});

app.post('/api/admin/login', (req, res) => {
  const login = sanitize(req.body.login, 80);
  const password = String(req.body.password || '');

  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ ok: false, message: 'ADMIN_PASSWORD не задан в .env' });
  }

  if (login !== ADMIN_LOGIN || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, message: 'Неверный логин или пароль.' });
  }

  const token = signAdminToken(login);
  const isSecure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${isSecure ? '; Secure' : ''}`);
  return res.json({ ok: true });
});

app.post('/api/admin/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res.json({ ok: true });
});

app.get('/api/admin/leads', requireAdmin, (req, res) => {
  const status = sanitize(req.query.status || 'all', 30);
  const leads = listLeads(status);
  const stats = getStats();
  return res.json({ ok: true, leads, stats });
});

app.patch('/api/admin/leads/:id', requireAdmin, (req, res) => {
  const id = sanitize(req.params.id, 80);
  const status = sanitize(req.body.status, 40);
  const managerNote = sanitize(req.body.managerNote, 2000);
  const allowed = new Set(['new', 'in_progress', 'done', 'archived']);

  if (!allowed.has(status)) {
    return res.status(400).json({ ok: false, message: 'Недопустимый статус.' });
  }

  const lead = updateLead(id, status, managerNote);
  if (!lead) {
    return res.status(404).json({ ok: false, message: 'Заявка не найдена.' });
  }

  return res.json({ ok: true, lead, message: 'Заявка обновлена.' });
});

app.post('/api/admin/leads/:id/archive', requireAdmin, (req, res) => {
  const id = sanitize(req.params.id, 80);
  const lead = updateLead(id, 'archived', sanitize(req.body.managerNote, 2000));
  if (!lead) {
    return res.status(404).json({ ok: false, message: 'Заявка не найдена.' });
  }
  return res.json({ ok: true, lead, message: 'Заявка отправлена в архив.' });
});

app.post('/api/admin/leads/:id/soft-delete', requireAdmin, (req, res) => {
  const id = sanitize(req.params.id, 80);
  const lead = softDeleteLead(id);
  if (!lead) {
    return res.status(404).json({ ok: false, message: 'Заявка не найдена.' });
  }
  return res.json({ ok: true, lead, message: 'Заявка мягко удалена. Она перенесена в раздел удалённых.' });
});

app.post('/api/admin/leads/:id/restore', requireAdmin, (req, res) => {
  const id = sanitize(req.params.id, 80);
  const lead = restoreLead(id);
  if (!lead) {
    return res.status(404).json({ ok: false, message: 'Заявка не найдена.' });
  }
  return res.json({ ok: true, lead, message: 'Заявка восстановлена и перенесена в архив.' });
});

app.delete('/api/admin/leads/:id', requireAdmin, (req, res) => {
  const id = sanitize(req.params.id, 80);
  const deleted = hardDeleteLead(id);
  if (!deleted) {
    return res.status(404).json({ ok: false, message: 'Заявка не найдена.' });
  }
  return res.json({ ok: true, message: 'Заявка удалена навсегда.' });
});

app.post('/api/leads', async (req, res) => {
  const validated = validateLead(req.body || {});

  if (!validated.ok) {
    return res.status(400).json(validated);
  }

  let emailSent = false;
  let telegramSent = false;

  try {
    try {
      const emailResult = await sendLeadEmail(validated.lead);
      emailSent = !!emailResult.sent;
    } catch (error) {
      console.error('Email error:', error.message);
    }

    try {
      const tgResult = await sendTelegramMessage(validated.lead);
      telegramSent = !!tgResult.sent;
    } catch (error) {
      console.error('Telegram error:', error.message);
    }

    saveLead(validated.lead, emailSent, telegramSent);

    let message = 'Заявка принята и сохранена в системе.';
    if (emailSent && telegramSent) {
      message = 'Заявка отправлена. Уведомления ушли на почту и в Telegram.';
    } else if (emailSent) {
      message = 'Заявка отправлена. Уведомление ушло на почту, а сама заявка сохранена в админке.';
    } else if (telegramSent) {
      message = 'Заявка отправлена. Уведомление ушло в Telegram, а сама заявка сохранена в админке.';
    }

    return res.json({
      ok: true,
      message,
      emailSent,
      telegramSent,
    });
  } catch (error) {
    console.error('Lead submit error:', error);
    return res.status(500).json({ ok: false, message: 'Ошибка на сервере при обработке заявки.' });
  }
});

app.listen(PORT, async () => {
  await ensureStorage();
  initDb();
  console.log(`Lakshmi site started on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
