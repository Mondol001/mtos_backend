import fs from 'fs';
import path from 'path';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
let fileConfig: Partial<FirebaseAppletConfig> = {};
if (fs.existsSync(configPath)) {
  try {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as FirebaseAppletConfig;
  } catch {
    fileConfig = {};
  }
}

export const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || fileConfig.projectId || 'mtos-4e99a';

export const FIRESTORE_DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID ||
  fileConfig.firestoreDatabaseId ||
  'ai-studio-21c7e74a-39cb-4f9d-a430-eb4d75bef908';

const adminApp = getApps().length
  ? getApp()
  : initializeApp({ projectId: FIREBASE_PROJECT_ID });

const adminAuth = getAuth(adminApp);

export const SUPER_ADMIN_EMAIL = 'mohammadiaqub@gmail.com';

export function isSuperAdminToken(decoded: DecodedIdToken | null): boolean {
  if (!decoded || !decoded.email) return false;
  return (
    decoded.email.trim().toLowerCase() === SUPER_ADMIN_EMAIL &&
    decoded.email_verified === true
  );
}

export async function verifyFirebaseBearerToken(
  token: string | undefined | null
): Promise<DecodedIdToken | null> {
  const clean = (token || '').trim();
  if (!clean) return null;
  try {
    return await adminAuth.verifyIdToken(clean);
  } catch {
    return null;
  }
}

export function extractBearerToken(
  authHeader: string | undefined,
  queryToken?: string
): string | null {
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }
  if (queryToken && queryToken.trim()) {
    return queryToken.trim();
  }
  return null;
}

type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
  mapValue?: { fields?: Record<string, FirestoreValue> };
  arrayValue?: { values?: FirestoreValue[] };
};

function decodeFirestoreValue(val: FirestoreValue): unknown {
  if ('stringValue' in val) return val.stringValue ?? '';
  if ('integerValue' in val) return Number(val.integerValue ?? 0);
  if ('doubleValue' in val) return Number(val.doubleValue ?? 0);
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    return (val.arrayValue?.values || []).map(decodeFirestoreValue);
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    const fields = val.mapValue?.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

/**
 * Reads a single Firestore document via the Firestore REST API forwarding the
 * caller's own Firebase Auth ID Token so Firestore Security Rules apply natively
 * with zero IAM service account privileges required.
 */
export async function getFirestoreDocAsUser(
  docPath: string,
  idToken: string
): Promise<Record<string, unknown> | null> {
  const cleanPath = docPath.replace(/^\/+/, '');
  const encodedPath = cleanPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    FIREBASE_PROJECT_ID
  )}/databases/${encodeURIComponent(
    FIRESTORE_DATABASE_ID
  )}/documents/${encodedPath}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      fields?: Record<string, FirestoreValue>;
    };
    if (!json.fields) return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(json.fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  } catch {
    return null;
  }
}
