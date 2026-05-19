import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth/server';
import { createUserSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/rbac';

function makeCode(prefix: string, name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4) || 'UNIT';
  const rand = Math.floor(100 + Math.random() * 900);
  return `${prefix}-${clean}${rand}`;
}

async function findOrCreateOrgUnit(name: string, type: 'markaz' | 'jimbo' | 'tawi', parentId: number | null) {
  const existing = await db.orgUnit.findFirst({
    where: { name: name.trim(), type, parentId, isActive: true },
  });
  if (existing) return existing;

  const prefix = type === 'markaz' ? 'MK' : type === 'jimbo' ? 'JM' : 'TW';
  const created = await db.orgUnit.create({
    data: {
      name: name.trim(),
      type,
      parentId,
      code: makeCode(prefix, name),
      isActive: true,
    },
  });
  return created;
}

export async function POST(request: NextRequest) {
  try {
    const rateLimit = checkRateLimit(request, 20);
    if (!rateLimit.allowed) {
      return NextResponse.json({ success: false, message: 'Maombi mengi sana. Jaribu tena baadaye.' }, { status: 429 });
    }

    const body = await request.json();
    const {
      fullName,
      username,
      email,
      password,
      role,
      orgLevel,
      orgName,
      parentName,
      securityQuestion,
      securityAnswer,
    } = body || {};

    if (!orgLevel || !orgName || !fullName || !username || !email || !password || !role || !securityQuestion || !securityAnswer) {
      return NextResponse.json({ success: false, message: 'Tafadhali jaza taarifa zote muhimu.' }, { status: 400 });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedUsername = String(username).trim().toLowerCase();

    const existingEmail = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (existingEmail) {
      return NextResponse.json({ success: false, message: 'Barua pepe tayari imetumika.' }, { status: 409 });
    }

    const existingUsername = await db.user.findFirst({ where: { username: normalizedUsername } });
    if (existingUsername) {
      return NextResponse.json({ success: false, message: 'Jina la mtumiaji tayari limetumika.' }, { status: 409 });
    }

    let orgUnitId: number;
    if (orgLevel === 'markaz') {
      const markaz = await findOrCreateOrgUnit(String(orgName), 'markaz', null);
      orgUnitId = markaz.id;
    } else if (orgLevel === 'jimbo') {
      let markaz = await db.orgUnit.findFirst({ where: { type: 'markaz', isActive: true } });
      if (!markaz) {
        markaz = await findOrCreateOrgUnit('Markaz Kuu', 'markaz', null);
      }
      const jimbo = await findOrCreateOrgUnit(String(orgName), 'jimbo', markaz.id);
      orgUnitId = jimbo.id;
    } else {
      if (!parentName) {
        return NextResponse.json({ success: false, message: 'Jina la Jimbo mzazi ni lazima.' }, { status: 400 });
      }
      let jimbo = await db.orgUnit.findFirst({
        where: { name: String(parentName).trim(), type: 'jimbo', isActive: true },
      });
      if (!jimbo) {
        let markaz = await db.orgUnit.findFirst({ where: { type: 'markaz', isActive: true } });
        if (!markaz) {
          markaz = await findOrCreateOrgUnit('Markaz Kuu', 'markaz', null);
        }
        jimbo = await findOrCreateOrgUnit(String(parentName), 'jimbo', markaz.id);
      }
      const tawi = await findOrCreateOrgUnit(String(orgName), 'tawi', jimbo.id);
      orgUnitId = tawi.id;
    }

    const parse = createUserSchema.safeParse({
      username: normalizedUsername,
      email: normalizedEmail,
      password: String(password),
      fullName: String(fullName),
      role: String(role),
      orgLevel: String(orgLevel),
      orgUnitId,
      securityQuestion: String(securityQuestion),
      securityAnswer: String(securityAnswer),
    });
    if (!parse.success) {
      return NextResponse.json({ success: false, message: parse.error.issues[0]?.message || 'Taarifa si sahihi.' }, { status: 400 });
    }

    const passwordHash = hashPassword(String(password));
    const securityAnswerHash = hashPassword(String(securityAnswer).trim().toLowerCase());

    await db.user.create({
      data: {
        username: normalizedUsername,
        email: normalizedEmail,
        fullName: String(fullName).trim(),
        passwordHash,
        role: String(role),
        orgLevel: String(orgLevel),
        orgUnitId,
        securityQuestion: String(securityQuestion),
        securityAnswerHash,
        isActive: true,
      },
    });

    return NextResponse.json({ success: true, message: 'Usajili umefanikiwa.' }, { status: 201 });
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json({ success: false, message: 'Hitilafu ya mfumo. Jaribu tena.' }, { status: 500 });
  }
}
