import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  BUILTIN_MAP_FILES,
  buildWatermarkedMapPreviewSvg,
  getBuiltInKhatianDetail,
  getBuiltInSurveyCounts,
  getBuiltInTotalCount,
  searchBuiltInPreviews,
  verifyBuiltInKhatianMeta,
} from './server/catalog.ts';
import {
  extractBearerToken,
  getFirestoreDocAsUser,
  isSuperAdminToken,
  verifyFirebaseBearerToken,
} from './server/firebaseAuth.ts';
import { makeUnlockId } from './src/utils/landRecords.ts';
import { getEffectiveUserRestriction, isUnlockActive } from './src/utils/billing.ts';

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  // Configurable CORS for Vercel Frontend domain
  const rawOrigins = process.env.ALLOWED_ORIGINS || process.env.CLIENT_ORIGIN || '*';
  const allowedOrigins = rawOrigins.split(',').map((o) => o.trim().replace(/\/+$/, ''));

  app.use((req, res, next) => {
    const origin = req.headers.origin ? req.headers.origin.replace(/\/+$/, '') : '';
    if (allowedOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (allowedOrigins.length > 0 && allowedOrigins[0]) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // Block direct unauthenticated fetching of protected HD mouja map assets
  app.use((req, res, next) => {
    if (req.path.startsWith('/src/assets/images/mouja_map_')) {
      res.status(403).json({
        error: 'মূল মৌজা ম্যাপ সরাসরি অ্যাক্সেস করা যাবে না। ক্রয় করে ডাউনলোড করুন।',
      });
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'mondol-telecom-online-services',
      builtInRecords: getBuiltInTotalCount(),
    });
  });

  app.get('/api/khatians/counts', (req, res) => {
    const moujaId = String(req.query.moujaId || '').trim();
    if (!moujaId) {
      res.status(400).json({ error: 'moujaId প্রয়োজন' });
      return;
    }
    res.json({ counts: getBuiltInSurveyCounts(moujaId) });
  });

  app.get('/api/khatians/preview', (req, res) => {
    const moujaId = String(req.query.moujaId || '').trim();
    const surveyType = String(req.query.surveyType || '').trim();
    const q = String(req.query.query || '');
    const searchFieldRaw = String(req.query.searchField || 'all');
    const searchField =
      searchFieldRaw === 'dag' ||
      searchFieldRaw === 'khatian' ||
      searchFieldRaw === 'owner'
        ? searchFieldRaw
        : 'all';
    const limitNum = Math.min(100, Math.max(1, Number(req.query.limit || 50)));

    if (!moujaId || !surveyType) {
      res.json({ items: [] });
      return;
    }

    const items = searchBuiltInPreviews({
      moujaId,
      surveyType,
      query: q,
      searchField,
      limit: limitNum,
    });
    res.json({ items });
  });

  app.post('/api/khatians/full', async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const decoded = await verifyFirebaseBearerToken(token);
    if (!decoded || !token) {
      res.status(401).json({
        error: 'পূর্ণাঙ্গ খতিয়ান দেখতে অনুগ্রহ করে লগইন করুন।',
      });
      return;
    }

    const body = (req.body || {}) as {
      moujaId?: string;
      surveyType?: string;
      khatianNo?: string;
    };
    const moujaId = String(body.moujaId || '').trim();
    const surveyType = String(body.surveyType || '').trim();
    const khatianNo = String(body.khatianNo || '').trim();

    if (!moujaId || !surveyType || !khatianNo) {
      res.status(400).json({ error: 'moujaId, surveyType এবং khatianNo প্রয়োজন।' });
      return;
    }

    const record = getBuiltInKhatianDetail(moujaId, surveyType, khatianNo);
    if (!record) {
      res.status(404).json({ error: 'খতিয়ানটি খুঁজে পাওয়া যায়নি।' });
      return;
    }

    if (isSuperAdminToken(decoded)) {
      res.json({ record });
      return;
    }

    const userProfile = await getFirestoreDocAsUser(`users/${decoded.uid}`, token);
    const restriction = getEffectiveUserRestriction(userProfile as never, Date.now());
    if (restriction.isBlocked) {
      res.status(403).json({
        error: 'আপনার একাউন্ট বর্তমানে সীমাবদ্ধ অবস্থায় রয়েছে।',
      });
      return;
    }

    const unlockId = makeUnlockId(moujaId, surveyType, khatianNo);
    const unlockDoc = await getFirestoreDocAsUser(
      `users/${decoded.uid}/unlockedKhatians/${unlockId}`,
      token
    );

    if (!unlockDoc) {
      res.status(403).json({
        error: 'এই খতিয়ানটি আপনার একাউন্টে আনলক করা নেই। আগে আনলক করুন।',
      });
      return;
    }

    const active = isUnlockActive(
      unlockDoc as { expiresAtMs?: number; durationMinutes?: number; createdAt?: unknown },
      Date.now(),
      Number(unlockDoc.durationMinutes || 10)
    );
    if (!active) {
      res.status(403).json({
        error: 'খতিয়ানটির আনলক মেয়াদ শেষ হয়ে গেছে। পুনরায় আনলক করুন।',
      });
      return;
    }

    res.json({ record });
  });

  app.get('/api/verify/khatian', (req, res) => {
    const moujaId = String(req.query.moujaId || '').trim();
    const surveyType = String(req.query.surveyType || '').trim();
    const khatianNo = String(req.query.khatianNo || '').trim();
    if (!moujaId || !surveyType || !khatianNo) {
      res.status(400).json({ valid: false, error: 'অসম্পূর্ণ তথ্য' });
      return;
    }
    res.json(verifyBuiltInKhatianMeta(moujaId, surveyType, khatianNo));
  });

  app.get('/api/maps/preview/:mapId', (req, res) => {
    const mapId = String(req.params.mapId || '').trim();
    const svg = buildWatermarkedMapPreviewSvg(mapId);
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(svg);
  });

  app.get('/api/maps/file/:mapId', async (req, res) => {
    const mapId = String(req.params.mapId || '').trim();
    const meta = BUILTIN_MAP_FILES[mapId];
    if (!meta || !fs.existsSync(meta.filePath)) {
      res.status(404).json({ error: 'মৌজা ম্যাপ ফাইল পাওয়া যায়নি।' });
      return;
    }

    const token = extractBearerToken(
      req.headers.authorization,
      typeof req.query.token === 'string' ? req.query.token : undefined
    );
    const decoded = await verifyFirebaseBearerToken(token);
    if (!decoded || !token) {
      res.status(401).json({ error: 'ম্যাপ দেখতে লগইন প্রয়োজন।' });
      return;
    }

    let authorized = isSuperAdminToken(decoded);
    if (!authorized) {
      const userProfile = await getFirestoreDocAsUser(`users/${decoded.uid}`, token);
      const restriction = getEffectiveUserRestriction(userProfile as never, Date.now());
      if (restriction.isBlocked) {
        res.status(403).json({ error: 'আপনার একাউন্ট বর্তমানে সীমাবদ্ধ।' });
        return;
      }
      const purchaseDoc = await getFirestoreDocAsUser(
        `users/${decoded.uid}/purchasedMaps/${mapId}`,
        token
      );
      authorized = Boolean(purchaseDoc);
    }

    if (!authorized) {
      res.status(403).json({ error: 'ম্যাপটি ডাউনলোড করতে আগে ক্রয় করুন।' });
      return;
    }

    if (req.query.download === '1') {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${mapId}.jpg"`
      );
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(meta.filePath);
  });

  if (!isProd && fs.existsSync(path.resolve(process.cwd(), 'vite.config.ts'))) {
    try {
      // @ts-ignore -- vite dev middleware optional when running combined dev mode
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch {
      // Standalone backend mode: serving API endpoints only
    }
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(
      `Mondol Telecom server listening on http://0.0.0.0:${port} (${
        isProd ? 'production' : 'development'
      })`
    );
  });
}

void startServer();
