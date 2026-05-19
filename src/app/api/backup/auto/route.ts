// ============================================================
// AMYC Financial Management System - Auto-Backup Cron API
// GET: Checks last backup timestamp and creates a new backup
//      if more than 24 hours have passed
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUserId, getSystemUserId } from '@/lib/api-helpers';
import fs from 'fs';
import path from 'path';

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), 'backups');
const BACKUP_VERSION = '2.1';
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Tafadhali ingia kama admin ili kuendesha auto-backup.' },
        { status: 401 }
      );
    }

    // Only admin can trigger auto-backup check
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role !== 'admin') {
      return NextResponse.json(
        { error: 'Huna ruhusa. Admin pekee anaweza.' },
        { status: 403 }
      );
    }

    // Check last auto backup timestamp from SystemSetting
    const lastBackupSetting = await db.systemSetting.findUnique({
      where: { key: 'last_auto_backup' },
    });

    const lastBackupTime = lastBackupSetting?.value
      ? new Date(lastBackupSetting.value)
      : null;

    const now = new Date();
    const timeSinceLastBackup = lastBackupTime
      ? now.getTime() - lastBackupTime.getTime()
      : AUTO_BACKUP_INTERVAL_MS + 1; // Force backup if never done

    const needsBackup = timeSinceLastBackup > AUTO_BACKUP_INTERVAL_MS;

    if (!needsBackup) {
      return NextResponse.json({
        success: true,
        message: 'Auto-backup haujahitajika. Backup ya hivi karibuni ipo.',
        lastAutoBackup: lastBackupTime?.toISOString() || null,
        nextAutoBackup: new Date(lastBackupTime!.getTime() + AUTO_BACKUP_INTERVAL_MS).toISOString(),
        hoursUntilNext: Math.round((AUTO_BACKUP_INTERVAL_MS - timeSinceLastBackup) / (60 * 60 * 1000) * 10) / 10,
      });
    }

    // Create auto backup
    ensureBackupDir();

    const [orgUnits, users, categories, transactions, attachments, approvalSteps, importBatches, monthlySubmissions, budgets, notes, auditLogs, notifications, syncQueue, systemSettings] = await Promise.all([
      db.orgUnit.findMany(),
      db.user.findMany({
        select: {
          id: true, username: true, email: true, fullName: true, role: true,
          orgLevel: true, orgUnitId: true, securityQuestion: true, securityAnswerHash: true,
          isActive: true, lastLoginAt: true, loginAttempts: true, lockedUntil: true,
          createdAt: true, updatedAt: true,
        },
      }),
      db.category.findMany(),
      db.transaction.findMany(),
      db.attachment.findMany({
        select: {
          id: true, fileName: true, fileType: true, fileSize: true,
          description: true, category: true, transactionId: true, orgUnitId: true,
          uploadedBy: true, createdAt: true,
        },
      }),
      db.approvalStep.findMany(),
      db.importBatch.findMany(),
      db.monthlySubmission.findMany(),
      db.budget.findMany(),
      db.note.findMany(),
      db.auditLog.findMany(),
      db.notification.findMany(),
      db.syncQueue.findMany(),
      db.systemSetting.findMany(),
    ]);

    const timestamp = now.toISOString();
    const backupData = {
      version: BACKUP_VERSION,
      timestamp,
      system: 'AMYC',
      manifest: {
        type: 'auto',
        createdBy: 'system',
        tables: {
          orgUnits: orgUnits.length,
          users: users.length,
          categories: categories.length,
          transactions: transactions.length,
          attachments: attachments.length,
          approvalSteps: approvalSteps.length,
          importBatches: importBatches.length,
          monthlySubmissions: monthlySubmissions.length,
          budgets: budgets.length,
          notes: notes.length,
          auditLogs: auditLogs.length,
          notifications: notifications.length,
          syncQueue: syncQueue.length,
          systemSettings: systemSettings.length,
        },
      },
      data: {
        orgUnits,
        users,
        categories,
        transactions,
        attachments,
        approvalSteps,
        importBatches,
        monthlySubmissions,
        budgets,
        notes,
        auditLogs,
        notifications,
        syncQueue,
        systemSettings,
      },
    };

    // Save to file
    const dateStr = now.toISOString().replace(/[:.]/g, '-').split('T')[0];
    const timeStr = now.toISOString().replace(/[:.]/g, '-').split('T')[1].split('-').slice(0, 3).join('-');
    const filename = `AMYC_backup_auto_${dateStr}_${timeStr}.json`;
    const filePath = path.join(BACKUP_DIR, filename);

    fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf-8');

    // Update last_auto_backup SystemSetting
    await db.systemSetting.upsert({
      where: { key: 'last_auto_backup' },
      update: { value: timestamp },
      create: { key: 'last_auto_backup', value: timestamp, type: 'string', category: 'general' },
    });

    // Log to AuditLog
    const auditUserId = userId || await getSystemUserId();
    await db.auditLog.create({
      data: {
        action: 'export',
        entity: 'backup',
        entityId: 0,
        userId: auditUserId,
        details: `Auto-backup iliyoundwa: ${filename} (${Object.values(backupData.manifest.tables).reduce((a, b) => a + b, 0)} rekodi)`,
        newValue: JSON.stringify({ filename, type: 'auto', tables: backupData.manifest.tables }),
        ipAddress: request.headers.get('x-forwarded-for') || null,
        userAgent: request.headers.get('user-agent') || null,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Auto-backup imeundwa kikamilifu!',
      lastAutoBackup: timestamp,
      nextAutoBackup: new Date(now.getTime() + AUTO_BACKUP_INTERVAL_MS).toISOString(),
      filename,
      totalRecords: Object.values(backupData.manifest.tables).reduce((a, b) => a + b, 0),
    });
  } catch (error) {
    console.error('Auto-backup error:', error);
    return NextResponse.json(
      { error: `Hitilafu ya auto-backup: ${error instanceof Error ? error.message : 'Hitilafu isiyojulikana'}` },
      { status: 500 }
    );
  }
}
