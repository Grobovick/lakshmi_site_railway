require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const multer = require('multer');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || DEFAULT_DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'lakshmi.sqlite');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const COOKIE_NAME = 'lakshmi_admin';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'change_this_cookie_secret';
const ACTIVE_STATUSES = ['new', 'in_progress', 'done', 'archived'];
const ALL_STATUSES = [...ACTIVE_STATUSES, 'deleted'];

app.use(express.json({ limit: '400kb' }));
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

function safeOriginalName(filename) {
  return String(filename || 'file')
    .replace(/[\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'file';
}

function extFrom(filename) {
  return path.extname(String(filename || '')).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
}

async function ensureStorage() {
  await fsPromises.mkdir(DATA_DIR, { recursive: true });
  await fsPromises.mkdir(UPLOAD_DIR, { recursive: true });
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
    CREATE TABLE IF NOT EXISTS lead_attachments (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      category TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lead_attachments_lead_id ON lead_attachments(lead_id);
    CREATE INDEX IF NOT EXISTS idx_lead_attachments_category ON lead_attachments(category);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_deleted_at ON leads(deleted_at);
  `);
}

function getNowId(prefix = '') {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      id: getNowId(),
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

function validateGamifiedLead(body, files) {
  const objectType = sanitize(body.objectType, 120);
  const objectAddress = sanitize(body.objectAddress, 220);
  const objectArea = sanitize(body.objectArea, 40);
  const cadastralNumber = sanitize(body.cadastralNumber, 80);
  const objectDetails = sanitize(body.objectDetails, 500);
  const purpose = sanitize(body.purpose, 120);
  const message = sanitize(body.message, 2000);
  const contactName = sanitize(body.contactName, 120);
  const contactPhone = sanitize(body.contactPhone, 40);
  const contactEmail = sanitize(body.contactEmail, 120);
  const consent = sanitize(body.consent, 10);
  const website = sanitize(body.website, 200);

  const rightDocs = files.rightDocs || [];
  const techDocs = files.techDocs || [];
  const photos = files.photos || [];
  const additionalFiles = files.additionalFiles || [];

  if (website) {
    return { ok: false, message: 'Заявка отклонена системой антиспама.' };
  }
  if (!rightDocs.length) {
    return { ok: false, message: 'Добавьте хотя бы один правоустанавливающий документ.' };
  }
  if (!objectType) {
    return { ok: false, message: 'Выберите тип объекта.' };
  }
  if (!objectAddress || objectAddress.length < 5) {
    return { ok: false, message: 'Укажите адрес объекта.' };
  }
  if (!objectArea) {
    return { ok: false, message: 'Укажите площадь или ключевой параметр объекта.' };
  }
  if (!photos.length) {
    return { ok: false, message: 'Добавьте хотя бы одну фотографию объекта.' };
  }
  if (!purpose) {
    return { ok: false, message: 'Выберите цель оценки.' };
  }
  if (!contactName || contactName.length < 2) {
    return { ok: false, message: 'Укажите имя для связи.' };
  }
  if (!contactPhone || contactPhone.length < 6) {
    return { ok: false, message: 'Укажите телефон для связи.' };
  }
  if (consent !== 'yes') {
    return { ok: false, message: 'Нужно согласие на обработку персональных данных.' };
  }

  const lead = {
    id: getNowId(),
    createdAt: new Date().toISOString(),
    name: contactName,
    phone: contactPhone,
    service: `Геймифицированная заявка — ${objectType}`,
    source: 'Геймифицированная страница сайта',
    status: 'new',
    managerNote: '',
    message: [
      `Тип объекта: ${objectType}`,
      `Адрес: ${objectAddress}`,
      `Площадь / основной параметр: ${objectArea}`,
      cadastralNumber ? `Кадастровый номер: ${cadastralNumber}` : '',
      objectDetails ? `Дополнительные характеристики: ${objectDetails}` : '',
      `Цель оценки: ${purpose}`,
      contactEmail ? `Email: ${contactEmail}` : 'Email: не указан',
      `Правоустанавливающие документы: ${rightDocs.length} файл(ов)`,
      `Технические документы: ${techDocs.length} файл(ов)`,
      `Фотографии: ${photos.length} файл(ов)`,
      `Дополнительные файлы: ${additionalFiles.length} файл(ов)`,
      `Комментарий: ${message || 'не указан'}`,
    ].filter(Boolean).join('\n'),
  };

  return {
    ok: true,
    lead,
    meta: {
      objectType,
      objectAddress,
      objectArea,
      cadastralNumber,
      objectDetails,
      purpose,
      message,
      contactEmail,
      rightDocs,
      techDocs,
      photos,
      additionalFiles,
    },
  };
}

function normalizeAttachment(row) {
  return row
    ? {
        ...row,
        size_bytes: Number(row.size_bytes || 0),
        download_url: `/api/admin/attachments/${encodeURIComponent(row.id)}/download`,
      }
    : null;
}

function getAttachmentById(id) {
  const row = db.prepare('SELECT * FROM lead_attachments WHERE id = ? LIMIT 1').get(id);
  return normalizeAttachment(row);
}

function getAttachmentsByLeadIds(leadIds) {
  const map = new Map();
  if (!leadIds.length) return map;
  const placeholders = leadIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM lead_attachments WHERE lead_id IN (${placeholders}) ORDER BY datetime(created_at) ASC`).all(...leadIds);
  rows.forEach((row) => {
    if (!map.has(row.lead_id)) map.set(row.lead_id, []);
    map.get(row.lead_id).push(normalizeAttachment(row));
  });
  return map;
}

function normalizeLead(row, attachments = []) {
  return row
    ? {
        ...row,
        email_sent: Boolean(row.email_sent),
        telegram_sent: Boolean(row.telegram_sent),
        is_deleted: row.status === 'deleted' || Boolean(row.deleted_at),
        attachments,
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

function saveAttachments(leadId, filesByCategory) {
  const stmt = db.prepare(`
    INSERT INTO lead_attachments (
      id, lead_id, category, original_name, stored_name, mime_type, size_bytes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  Object.entries(filesByCategory).forEach(([category, files]) => {
    (files || []).forEach((file) => {
      stmt.run(
        getNowId('att-'),
        leadId,
        category,
        safeOriginalName(file.originalname),
        file.filename,
        sanitize(file.mimetype, 120),
        Number(file.size || 0),
        new Date().toISOString(),
      );
    });
  });
}

async function removeAttachmentFilesForLead(leadId) {
  const rows = db.prepare('SELECT stored_name FROM lead_attachments WHERE lead_id = ?').all(leadId);
  for (const row of rows) {
    const filePath = path.join(UPLOAD_DIR, row.stored_name);
    await fsPromises.unlink(filePath).catch(() => {});
  }
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
  const rows = db.prepare(sql).all(...params);
  const attachmentsByLead = getAttachmentsByLeadIds(rows.map((row) => row.id));
  return rows.map((row) => normalizeLead(row, attachmentsByLead.get(row.id) || []));
}

function getLeadById(id) {
  const row = db.prepare('SELECT * FROM leads WHERE id = ? LIMIT 1').get(id);
  const attachments = row ? getAttachmentsByLeadIds([row.id]).get(row.id) || [] : [];
  return normalizeLead(row, attachments);
}

function updateLead(id, status, managerNote) {
  const normalizedStatus = status === 'deleted' ? 'deleted' : status;
  const deletedAt = normalizedStatus === 'deleted' ? new Date().toISOString() : null;
  db.prepare(`
    UPDATE leads
    SET status = ?, manager_note = ?, deleted_at = ?
    WHERE id = ?
  `).run(normalizedStatus, managerNote, deletedAt, id);
  return getLeadById(id);
}

function softDeleteLead(id) {
  db.prepare(`
    UPDATE leads
    SET status = 'deleted', deleted_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), id);
  return getLeadById(id);
}

function restoreLead(id) {
  db.prepare(`
    UPDATE leads
    SET status = 'archived', deleted_at = NULL
    WHERE id = ?
  `).run(id);
  return getLeadById(id);
}

async function hardDeleteLead(id) {
  await removeAttachmentFilesForLead(id);
  db.prepare('DELETE FROM lead_attachments WHERE lead_id = ?').run(id);
  const result = db.prepare('DELETE FROM leads WHERE id = ?').run(id);
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

const uploadStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    const extension = extFrom(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`);
  },
});

const gamifiedUpload = multer({
  storage: uploadStorage,
  limits: {
    files: 18,
    fileSize: 15 * 1024 * 1024,
  },
  fileFilter(_req, file, cb) {
    const allowedExt = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx', '.heic', '.webp'];
    const ext = extFrom(file.originalname);
    if (!allowedExt.includes(ext) && !String(file.mimetype || '').startsWith('image/')) {
      return cb(new Error('Допустимы PDF, DOC, DOCX, XLS, XLSX и изображения.'));
    }
    cb(null, true);
  },
}).fields([
  { name: 'rightDocs', maxCount: 5 },
  { name: 'techDocs', maxCount: 5 },
  { name: 'photos', maxCount: 8 },
  { name: 'additionalFiles', maxCount: 5 },
]);

async function cleanupUploadedFiles(files) {
  const all = Object.values(files || {}).flat();
  for (const file of all) {
    if (file?.path) {
      await fsPromises.unlink(file.path).catch(() => {});
    }
  }
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

app.get('/api/admin/attachments/:id/download', requireAdmin, (req, res) => {
  const id = sanitize(req.params.id, 80);
  const attachment = getAttachmentById(id);
  if (!attachment) {
    return res.status(404).send('Файл не найден');
  }
  const filePath = path.join(UPLOAD_DIR, attachment.stored_name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Файл не найден на диске');
  }
  return res.download(filePath, attachment.original_name);
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

app.delete('/api/admin/leads/:id', requireAdmin, async (req, res) => {
  const id = sanitize(req.params.id, 80);
  const deleted = await hardDeleteLead(id);
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

    return res.json({ ok: true, message, emailSent, telegramSent });
  } catch (error) {
    console.error('Lead submit error:', error);
    return res.status(500).json({ ok: false, message: 'Ошибка на сервере при обработке заявки.' });
  }
});

app.post('/api/gamified-leads', (req, res) => {
  gamifiedUpload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ ok: false, message: err.message || 'Не удалось загрузить файлы.' });
    }

    const files = req.files || {};
    const validated = validateGamifiedLead(req.body || {}, files);

    if (!validated.ok) {
      await cleanupUploadedFiles(files);
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
      saveAttachments(validated.lead.id, files);

      return res.json({
        ok: true,
        message: 'Геймифицированная заявка отправлена. Все файлы сохранены, а карточка передана компании.',
        emailSent,
        telegramSent,
        uploaded: {
          rightDocs: (files.rightDocs || []).length,
          techDocs: (files.techDocs || []).length,
          photos: (files.photos || []).length,
          additionalFiles: (files.additionalFiles || []).length,
        },
      });
    } catch (error) {
      console.error('Gamified lead submit error:', error);
      await cleanupUploadedFiles(files);
      return res.status(500).json({ ok: false, message: 'Ошибка на сервере при обработке геймифицированной заявки.' });
    }
  });
});

app.listen(PORT, async () => {
  await ensureStorage();
  initDb();
  console.log(`Lakshmi site started on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
