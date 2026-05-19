// ============================================================
// AMYC Financial Management System - File Upload Utilities
// Secure file handling: validation, sanitization, storage
// ============================================================

import { randomUUID } from 'crypto';
import path from 'path';

// ============================================================
// Constants
// ============================================================

/** Allowed MIME types for file uploads */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain',
] as const;

/** Maximum file size: 10MB */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum filename length after sanitization */
export const MAX_FILENAME_LENGTH = 255;

/** Upload directory (absolute path) */
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

// ============================================================
// MIME type to extension mapping
// ============================================================

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
  'text/plain': '.txt',
};

// ============================================================
// Validation Functions
// ============================================================

/**
 * Validate that a MIME type is in the allowed list.
 * @returns true if the MIME type is allowed
 */
export function validateFileType(mimeType: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Validate that a file size is within the allowed limit.
 * @returns true if the file size is within limits
 */
export function validateFileSize(size: number): boolean {
  return size > 0 && size <= MAX_FILE_SIZE;
}

/**
 * Sanitize a filename by removing path traversal characters and limiting length.
 * - Removes directory separators and parent directory references
 * - Removes null bytes and control characters
 * - Limits filename length
 * - Preserves the file extension
 */
export function sanitizeFileName(fileName: string): string {
  if (!fileName || typeof fileName !== 'string') return 'unnamed';

  return (
    fileName
      // Remove path components (keep only the base name)
      .replace(/^.*[\/\\]/, '')
      // Remove null bytes
      .replace(/\0/g, '')
      // Remove control characters (0x00-0x1F, 0x7F)
      .replace(/[\x00-\x1F\x7F]/g, '')
      // Remove parent directory references
      .replace(/\.\./g, '')
      // Remove leading dots (hidden files)
      .replace(/^\./, '_')
      // Remove potentially dangerous characters
      .replace(/[<>:"|?*]/g, '_')
      // Collapse multiple underscores
      .replace(/_+/g, '_')
      // Trim whitespace
      .trim()
      // Limit length (preserve extension)
      .slice(0, MAX_FILENAME_LENGTH) || 'unnamed'
  );
}

/**
 * Generate a unique filename using timestamp + UUID + original extension.
 * Format: {timestamp}-{uuid}{originalExtension}
 */
export function generateUniqueFileName(originalName: string): string {
  const sanitizedName = sanitizeFileName(originalName);
  const ext = path.extname(sanitizedName).toLowerCase();
  const timestamp = Date.now();
  const uuid = randomUUID().slice(0, 8); // Use first 8 chars of UUID for brevity
  return `${timestamp}-${uuid}${ext}`;
}

/**
 * Get the expected file extension for a given MIME type.
 * Returns the extension with a leading dot (e.g., '.jpg', '.pdf').
 * Falls back to '.bin' if MIME type is unknown.
 */
export function getExtensionFromMime(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType] || '.bin';
}

/**
 * Format file size for human-readable display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Get a human-readable category label in Swahili.
 */
export function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    receipt: 'Risiti',
    voucher: 'Vocha',
    invoice: 'Ankara',
    contract: 'Mkataba',
    other: 'Nyingine',
  };
  return labels[category] || category;
}

/**
 * Get the icon name for a file type category.
 */
export function getFileTypeIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType.includes('sheet')
  )
    return 'spreadsheet';
  if (mimeType.startsWith('text/')) return 'text';
  return 'file';
}
