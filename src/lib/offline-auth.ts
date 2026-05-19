// Offline login + mirror server users into Dexie for offline sessions

import {
  db,
  findUserByEmail,
  getOrgUnitById,
  verifyPassword,
} from '@/lib/db-offline';
import type { OrgUnit, User } from '@/lib/types';
import { mirrorNativeRecord } from '@/lib/storage/native-record-store';

export type OfflineLoginResult =
  | { ok: true; user: User; org: OrgUnit }
  | { ok: false; message: string };

/** Authenticate against IndexedDB (no network). */
export async function loginOffline(
  email: string,
  password: string
): Promise<OfflineLoginResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await findUserByEmail(normalizedEmail);

  if (!user) {
    return {
      ok: false,
      message:
        'Akaunti haipatikani kwenye kifaa hiki. Ingia mara moja ukiwa mtandaoni ili kuhifadhi akaunti.',
    };
  }

  if (!user.isActive) {
    return { ok: false, message: 'Akaunti yako imelemazwa. Wasiliana na msimamizi.' };
  }

  const passwordOk = await verifyPassword(password, user.password);
  if (!passwordOk) {
    return { ok: false, message: 'Barua pepe au nenosiri si sahihi.' };
  }

  const org = await getOrgUnitById(user.orgUnitId);
  if (!org) {
    return {
      ok: false,
      message: 'Taarifa za taasisi hazipatikani kwenye kifaa. Ingia tena ukiwa mtandaoni.',
    };
  }

  return { ok: true, user, org };
}

/** After successful API login, copy user + org into Dexie for future offline login. */
export async function mirrorSessionToDexie(
  apiUser: {
    id: number;
    username?: string | null;
    email: string;
    fullName?: string | null;
    role: string;
    orgLevel: string;
    orgUnitId?: number | null;
    passwordHash?: string | null;
    securityQuestion?: string | null;
    securityAnswerHash?: string | null;
    isActive?: boolean;
  },
  orgUnit: {
    id: number;
    name: string;
    type: string;
    parentId?: number | null;
    code: string;
    isActive?: boolean;
  },
  plainPassword?: string
): Promise<void> {
  const now = new Date().toISOString();
  const orgId = orgUnit.id;

  const existingOrg = await db.orgUnits.get(orgId);
  const orgRecord: OrgUnit = {
    id: orgId,
    name: orgUnit.name,
    type: orgUnit.type as OrgUnit['type'],
    parentId: orgUnit.parentId ?? null,
    code: orgUnit.code,
    isActive: orgUnit.isActive ?? true,
    createdAt: existingOrg?.createdAt ?? now,
    updatedAt: now,
    mudirName: existingOrg?.mudirName,
    mudirSignature: existingOrg?.mudirSignature,
    mwekahazinaName: existingOrg?.mwekahazinaName,
    mwekahazinaSignature: existingOrg?.mwekahazinaSignature,
  };

  if (existingOrg) {
    await db.orgUnits.update(orgId, orgRecord);
  } else {
    await db.orgUnits.put(orgRecord);
  }
  await mirrorNativeRecord('orgUnits', orgId, orgRecord, { orgUnitId: orgId }).catch((error) => {
    console.warn('[AMYC Auth] Native org mirror skipped; Dexie session is saved.', error);
  });

  let passwordHash = apiUser.passwordHash ?? '';
  if (plainPassword) {
    const { hashPassword } = await import('@/lib/db-offline');
    passwordHash = await hashPassword(plainPassword);
  }

  const existingUser = await db.users.get(apiUser.id);
  const userRecord: User = {
    id: apiUser.id,
    username: apiUser.username || apiUser.email.split('@')[0],
    email: apiUser.email.toLowerCase().trim(),
    password: passwordHash || existingUser?.password || '',
    fullName: apiUser.fullName || apiUser.email,
    role: apiUser.role as User['role'],
    orgLevel: apiUser.orgLevel as User['orgLevel'],
    orgUnitId: apiUser.orgUnitId ?? orgId,
    securityQuestion:
      apiUser.securityQuestion || existingUser?.securityQuestion || SECURITY_FALLBACK,
    securityAnswer:
      apiUser.securityAnswerHash || existingUser?.securityAnswer || '',
    isActive: apiUser.isActive ?? true,
    createdAt: existingUser?.createdAt ?? now,
    updatedAt: now,
  };

  if (existingUser) {
    await db.users.update(apiUser.id, userRecord);
  } else {
    await db.users.put(userRecord);
  }
  await mirrorNativeRecord('users', apiUser.id, userRecord, { orgUnitId: userRecord.orgUnitId }).catch((error) => {
    console.warn('[AMYC Auth] Native user mirror skipped; Dexie session is saved.', error);
  });
}

const SECURITY_FALLBACK = 'Jina la mama yako ni nani?';
