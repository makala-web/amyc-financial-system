// ============================================================
// AMYC Financial Management System - Backup List API
// GET: Lists all available backups from the backup directory
// Returns metadata: filename, size, date, type (auto/manual)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUserId } from '@/lib/api-helpers';
import fs from 'fs';
import path from 'path';

const BACKUP_DIR = process.env.BACKUP_DIR || 'backups';

interface BackupInfo {
  filename: string;
  size: number;
  sizeFormatted: string;
  date: string;
  type: 'auto' | 'manual' | 'pre-restore-safety' | 'unknown';
  version?: string;
  recordCount?: number;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function parseBackupType(filename: string): BackupInfo['type'] {
  if (filename.includes('_auto_')) return 'auto';
  if (filename.includes('_manual_')) return 'manual';
  if (filename.includes('_pre-restore_')) return 'pre-restore-safety';
  return 'unknown';
}

function parseBackupDate(filename: string): string {
  // Extract date from filename pattern: AMYC_backup_TYPE_YYYY-MM-DD_HH-MM-SS.json
  const match = filename.match(/(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}T${match[2]}:${match[3]}:${match[4]}`;
  }
  return '';
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Tafadhali ingia kama admin ili kuona backups.' },
        { status: 401 }
      );
    }

    // Only admin can list backups
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

    // Ensure directory exists
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      return NextResponse.json({
        success: true,
        backups: [],
        totalSize: 0,
        totalSizeFormatted: '0 B',
      });
    }

    // Read all backup files
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse(); // Most recent first

    const backups: BackupInfo[] = [];

    for (const file of files) {
      const filePath = path.join(BACKUP_DIR, file);
      const stats = fs.statSync(filePath);

      let version: string | undefined;
      let recordCount: number | undefined;

      // Try to read metadata from the backup file (just the beginning)
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        version = parsed.version;
        recordCount = parsed.manifest?.tables
          ? Object.values(parsed.manifest.tables as Record<string, number>).reduce((a, b) => a + b, 0)
          : undefined;
      } catch {
        // If we can't parse, just skip metadata
      }

      backups.push({
        filename: file,
        size: stats.size,
        sizeFormatted: formatFileSize(stats.size),
        date: parseBackupDate(file) || stats.mtime.toISOString(),
        type: parseBackupType(file),
        version,
        recordCount,
      });
    }

    const totalSize = backups.reduce((sum, b) => sum + b.size, 0);

    // Get last auto backup time from SystemSetting
    const lastAutoBackupSetting = await db.systemSetting.findUnique({
      where: { key: 'last_auto_backup' },
    });

    return NextResponse.json({
      success: true,
      backups,
      totalSize,
      totalSizeFormatted: formatFileSize(totalSize),
      backupDirectory: BACKUP_DIR,
      lastAutoBackup: lastAutoBackupSetting?.value || null,
    });
  } catch (error) {
    console.error('Backup list error:', error);
    return NextResponse.json(
      { error: `Hitilafu ya kuorodhesha backup: ${error instanceof Error ? error.message : 'Hitilafu isiyojulikana'}` },
      { status: 500 }
    );
  }
}

