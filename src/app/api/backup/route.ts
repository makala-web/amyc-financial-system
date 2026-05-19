// ============================================================
// AMYC Financial Management System - Backup & Disaster Recovery API
// GET: Create full database backup as downloadable JSON
// POST: Restore from a backup file
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUserId, getSystemUserId, createAuditLog } from '@/lib/api-helpers';
import fs from 'fs';
import path from 'path';

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), 'backups');
const BACKUP_VERSION = '2.1';

// Ensure backup directory exists
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// ============================================================
// GET - Create Full Database Backup
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Tafadhali ingia kama admin ili kutumia backup.' },
        { status: 401 }
      );
    }

    // Only admin can create backups
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role !== 'admin') {
      return NextResponse.json(
        { error: 'Huna ruhusa ya kuunda backup. Admin pekee anaweza.' },
        { status: 403 }
      );
    }

    ensureBackupDir();

    // Export all tables (exclude passwordHash for security)
    const [orgUnits, users, categories, transactions, attachments, approvalSteps, importBatches, monthlySubmissions, budgets, notes, auditLogs, notifications, syncQueue, systemSettings] = await Promise.all([
      db.orgUnit.findMany(),
      db.user.findMany({
        select: {
          id: true,
          username: true,
          email: true,
          fullName: true,
          role: true,
          orgLevel: true,
          orgUnitId: true,
          securityQuestion: true,
          securityAnswerHash: true,
          isActive: true,
          lastLoginAt: true,
          loginAttempts: true,
          lockedUntil: true,
          createdAt: true,
          updatedAt: true,
          // passwordHash intentionally EXCLUDED
        },
      }),
      db.category.findMany(),
      db.transaction.findMany(),
      db.attachment.findMany({
        select: {
          id: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          description: true,
          category: true,
          transactionId: true,
          orgUnitId: true,
          uploadedBy: true,
          createdAt: true,
          // fileData intentionally EXCLUDED (binary data too large for JSON backup)
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

    // Create backup manifest
    const timestamp = new Date().toISOString();
    const backupData = {
      version: BACKUP_VERSION,
      timestamp,
      system: 'AMYC',
      manifest: {
        type: 'manual',
        createdBy: userId || 'system',
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

    // Save backup to file system
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const timeStr = new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].split('-').slice(0, 3).join('-');
    const filename = `AMYC_backup_manual_${dateStr}_${timeStr}.json`;
    const filePath = path.join(BACKUP_DIR, filename);

    fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf-8');

    // Log to AuditLog
    const auditUserId = userId || await getSystemUserId();
    await db.auditLog.create({
      data: {
        action: 'export',
        entity: 'backup',
        entityId: 0,
        userId: auditUserId,
        details: `Backup iliyoundwa: ${filename} (${Object.values(backupData.manifest.tables).reduce((a, b) => a + b, 0)} rekodi)`,
        newValue: JSON.stringify({ filename, tables: backupData.manifest.tables }),
        ipAddress: request.headers.get('x-forwarded-for') || null,
        userAgent: request.headers.get('user-agent') || null,
      },
    });

    // Return as downloadable JSON
    const jsonStr = JSON.stringify(backupData, null, 2);
    return new NextResponse(jsonStr, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Backup creation error:', error);
    return NextResponse.json(
      { error: `Hitilafu ya kuunda backup: ${error instanceof Error ? error.message : 'Hitilafu isiyojulikana'}` },
      { status: 500 }
    );
  }
}

// ============================================================
// POST - Restore from Backup
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Tafadhali ingia kama admin ili kurudisha backup.' },
        { status: 401 }
      );
    }

    // Only admin can restore backups
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role !== 'admin') {
      return NextResponse.json(
        { error: 'Huna ruhusa ya kurudisha backup. Admin pekee anaweza.' },
        { status: 403 }
      );
    }

    ensureBackupDir();

    // Parse the backup JSON from request body
    const body = await request.json();

    // Validate backup format
    if (!body || !body.version || !body.system || !body.data) {
      return NextResponse.json(
        { error: 'Faili ya backup si sahihi. Muundo haupo.' },
        { status: 400 }
      );
    }

    if (body.system !== 'AMYC') {
      return NextResponse.json(
        { error: 'Faili hii si backup ya mfumo wa AMYC.' },
        { status: 400 }
      );
    }

    // Version compatibility check
    const backupVersion = parseFloat(body.version);
    if (backupVersion > parseFloat(BACKUP_VERSION)) {
      return NextResponse.json(
        { error: `Backup ya toleo ${body.version} haiwezi kurudishwa kwenye mfumo wa toleo ${BACKUP_VERSION}. Boresha mfumo kwanza.` },
        { status: 400 }
      );
    }

    // === CREATE PRE-RESTORE SAFETY BACKUP ===
    // Automatically create a safety backup before restoring
    try {
      const safetyBackupData = {
        version: BACKUP_VERSION,
        timestamp: new Date().toISOString(),
        system: 'AMYC',
        manifest: {
          type: 'pre-restore-safety',
          createdBy: userId || 'system',
          reason: 'Auto-backup kabla ya kurudisha backup nyingine',
          tables: {},
        },
        data: {},
      };

      // Quick export of current state for safety
      const [currentOrgUnits, currentUsers, currentCategories, currentTransactions, currentAttachments, currentApprovalSteps, currentImportBatches, currentSubmissions, currentBudgets, currentNotes, currentAuditLogs, currentNotifications, currentSyncQueue, currentSettings] = await Promise.all([
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

      const allCurrentTables = {
        orgUnits: currentOrgUnits,
        users: currentUsers,
        categories: currentCategories,
        transactions: currentTransactions,
        attachments: currentAttachments,
        approvalSteps: currentApprovalSteps,
        importBatches: currentImportBatches,
        monthlySubmissions: currentSubmissions,
        budgets: currentBudgets,
        notes: currentNotes,
        auditLogs: currentAuditLogs,
        notifications: currentNotifications,
        syncQueue: currentSyncQueue,
        systemSettings: currentSettings,
      };

      safetyBackupData.data = allCurrentTables;
      (safetyBackupData.manifest as Record<string, unknown>).tables = Object.fromEntries(
        Object.entries(allCurrentTables).map(([key, val]) => [key, Array.isArray(val) ? val.length : 0])
      );

      const safetyDate = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      const safetyTime = new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].split('-').slice(0, 3).join('-');
      const safetyFilename = `AMYC_backup_pre-restore_${safetyDate}_${safetyTime}.json`;
      const safetyPath = path.join(BACKUP_DIR, safetyFilename);

      fs.writeFileSync(safetyPath, JSON.stringify(safetyBackupData, null, 2), 'utf-8');
    } catch (safetyError) {
      console.warn('Pre-restore safety backup failed:', safetyError);
      // Continue with restore even if safety backup fails
    }

    // === CLEAR AND RESTORE ===
    // Delete in correct order respecting foreign key constraints
    const deleteOrder = [
      () => db.syncQueue.deleteMany(),
      () => db.notification.deleteMany(),
      () => db.approvalStep.deleteMany(),
      () => db.attachment.deleteMany(),
      () => db.auditLog.deleteMany(),
      () => db.note.deleteMany(),
      () => db.transaction.deleteMany(),
      () => db.monthlySubmission.deleteMany(),
      () => db.budget.deleteMany(),
      () => db.importBatch.deleteMany(),
      () => db.category.deleteMany(),
      () => db.systemSetting.deleteMany(),
      () => db.user.deleteMany(),
      () => db.orgUnit.deleteMany(),
    ];

    for (const deleteFn of deleteOrder) {
      await deleteFn();
    }

    const data = body.data;
    let restoredCounts = {
      orgUnits: 0,
      users: 0,
      categories: 0,
      transactions: 0,
      attachments: 0,
      approvalSteps: 0,
      importBatches: 0,
      monthlySubmissions: 0,
      budgets: 0,
      notes: 0,
      auditLogs: 0,
      notifications: 0,
      syncQueue: 0,
      systemSettings: 0,
    };

    // Restore in correct order (parent tables first)
    // 1. OrgUnits (root entity)
    if (data.orgUnits?.length) {
      for (const item of data.orgUnits) {
        await db.orgUnit.create({ data: { ...item, children: undefined, users: undefined, transactions: undefined, notes: undefined, submissions: undefined, budgets: undefined, importSources: undefined, importTargets: undefined, categories: undefined, notifications: undefined, attachments: undefined } });
        restoredCounts.orgUnits++;
      }
    }

    // 2. Users
    if (data.users?.length) {
      for (const item of data.users) {
        await db.user.create({ data: { ...item, transactions: undefined, auditLogs: undefined, importBatches: undefined, notes: undefined, submissions: undefined, budgets: undefined, approvedTransactions: undefined, reviewedTransactions: undefined, approvedSubmissions: undefined, approvedBudgets: undefined, notifications: undefined, approvalSteps: undefined, attachments: undefined, syncQueue: undefined, orgUnit: undefined } });
        restoredCounts.users++;
      }
    }

    // 3. Categories
    if (data.categories?.length) {
      for (const item of data.categories) {
        await db.category.create({ data: { ...item, orgUnit: undefined, transactions: undefined } });
        restoredCounts.categories++;
      }
    }

    // 4. SystemSettings
    if (data.systemSettings?.length) {
      for (const item of data.systemSettings) {
        await db.systemSetting.create({ data: item });
        restoredCounts.systemSettings++;
      }
    }

    // 5. Transactions
    if (data.transactions?.length) {
      for (const item of data.transactions) {
        await db.transaction.create({ data: { ...item, orgUnit: undefined, category: undefined, enteredByUser: undefined, importBatch: undefined, approver: undefined, reviewer: undefined, attachments: undefined, approvalSteps: undefined } });
        restoredCounts.transactions++;
      }
    }

    // 6. Attachments
    if (data.attachments?.length) {
      for (const item of data.attachments) {
        await db.attachment.create({ data: { ...item, transaction: undefined, orgUnit: undefined, uploader: undefined } });
        restoredCounts.attachments++;
      }
    }

    // 7. ApprovalSteps
    if (data.approvalSteps?.length) {
      for (const item of data.approvalSteps) {
        await db.approvalStep.create({ data: { ...item, user: undefined, transaction: undefined } });
        restoredCounts.approvalSteps++;
      }
    }

    // 8. ImportBatches
    if (data.importBatches?.length) {
      for (const item of data.importBatches) {
        await db.importBatch.create({ data: { ...item, sourceOrg: undefined, targetOrg: undefined, importer: undefined, transactions: undefined } });
        restoredCounts.importBatches++;
      }
    }

    // 9. MonthlySubmissions
    if (data.monthlySubmissions?.length) {
      for (const item of data.monthlySubmissions) {
        await db.monthlySubmission.create({ data: { ...item, orgUnit: undefined, submitter: undefined, approver: undefined } });
        restoredCounts.monthlySubmissions++;
      }
    }

    // 10. Budgets
    if (data.budgets?.length) {
      for (const item of data.budgets) {
        await db.budget.create({ data: { ...item, orgUnit: undefined, creator: undefined, approver: undefined } });
        restoredCounts.budgets++;
      }
    }

    // 11. Notes
    if (data.notes?.length) {
      for (const item of data.notes) {
        await db.note.create({ data: { ...item, orgUnit: undefined, author: undefined } });
        restoredCounts.notes++;
      }
    }

    // 12. AuditLogs
    if (data.auditLogs?.length) {
      for (const item of data.auditLogs) {
        await db.auditLog.create({ data: { ...item, user: undefined } });
        restoredCounts.auditLogs++;
      }
    }

    // 13. Notifications
    if (data.notifications?.length) {
      for (const item of data.notifications) {
        await db.notification.create({ data: { ...item, user: undefined, orgUnit: undefined } });
        restoredCounts.notifications++;
      }
    }

    // 14. SyncQueue
    if (data.syncQueue?.length) {
      for (const item of data.syncQueue) {
        await db.syncQueue.create({ data: { ...item, user: undefined } });
        restoredCounts.syncQueue++;
      }
    }

    // Log the restore action to AuditLog
    const auditUserId = userId || await getSystemUserId();
    await db.auditLog.create({
      data: {
        action: 'import',
        entity: 'backup',
        entityId: 0,
        userId: auditUserId,
        details: `Backup imerudishwa kutoka: ${body.timestamp || 'haijulikani'}. Rekodi: ${Object.values(restoredCounts).reduce((a, b) => a + b, 0)}`,
        newValue: JSON.stringify({ sourceTimestamp: body.timestamp, restoredCounts }),
        ipAddress: request.headers.get('x-forwarded-for') || null,
        userAgent: request.headers.get('user-agent') || null,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Backup imerudishwa kikamilifu!',
      restoredCounts,
      totalRestored: Object.values(restoredCounts).reduce((a: number, b: number) => a + b, 0),
    });
  } catch (error) {
    console.error('Backup restore error:', error);
    return NextResponse.json(
      { error: `Hitilafu ya kurudisha backup: ${error instanceof Error ? error.message : 'Hitilafu isiyojulikana'}` },
      { status: 500 }
    );
  }
}
