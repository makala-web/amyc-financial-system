'use client';

// ============================================================
// AMYC Financial Management System - Attachment Manager Component
// Reusable component for managing file attachments on transactions
// Features: drag-and-drop, upload, download, delete, category selector
// ============================================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Upload,
  Download,
  Trash2,
  FileText,
  FileImage,
  FileSpreadsheet,
  File,
  Paperclip,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';

// ============================================================
// Types
// ============================================================

interface AttachmentRecord {
  id: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  category: string;
  description: string | null;
  transactionId: number | null;
  orgUnitId: number | null;
  uploadedBy: number;
  createdAt: string;
  uploader?: { id: number; fullName: string };
}

interface AttachmentManagerProps {
  orgUnitId: number;
  transactionId?: number;
}

// ============================================================
// Constants
// ============================================================

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const CATEGORY_OPTIONS = [
  { value: 'receipt', label: 'Risiti' },
  { value: 'voucher', label: 'Vocha' },
  { value: 'invoice', label: 'Ankara' },
  { value: 'contract', label: 'Mkataba' },
  { value: 'other', label: 'Nyingine' },
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  receipt: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  voucher: 'bg-blue-100 text-blue-800 border-blue-200',
  invoice: 'bg-amber-100 text-amber-800 border-amber-200',
  contract: 'bg-purple-100 text-purple-800 border-purple-200',
  other: 'bg-gray-100 text-gray-800 border-gray-200',
};

// ============================================================
// Helpers
// ============================================================

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function getCategoryLabel(category: string): string {
  return CATEGORY_OPTIONS.find((c) => c.value === category)?.label || category;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType === 'application/pdf') return FileText;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel'))
    return FileSpreadsheet;
  if (mimeType.startsWith('text/')) return FileText;
  return File;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('sw-TZ', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function getAuthToken(): string | null {
  try {
    const stored = localStorage.getItem('amyc-auth-store');
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed?.state?.authToken || null;
    }
  } catch {}
  return null;
}

// ============================================================
// Component
// ============================================================

export default function AttachmentManager({
  orgUnitId,
  transactionId,
}: AttachmentManagerProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string>('receipt');
  const [isDragOver, setIsDragOver] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AttachmentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ============================================================
  // Fetch attachments
  // ============================================================

  const fetchAttachments = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {
        orgUnitId: String(orgUnitId),
      };
      if (transactionId) {
        params.transactionId = String(transactionId);
      }
      const searchParams = new URLSearchParams(params);
      const token = getAuthToken();
      const res = await fetch(`/api/uploads?${searchParams}`, {
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Hitilafu ya mtandao' }));
        throw new Error(err.error || 'Hitilafu ya mtandao');
      }
      const data = await res.json();
      setAttachments(data.attachments || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Imeshindwa kupakia viambatisho');
    } finally {
      setLoading(false);
    }
  }, [orgUnitId, transactionId]);

  useEffect(() => {
    fetchAttachments();
  }, [fetchAttachments]);

  // ============================================================
  // Upload file
  // ============================================================

  const uploadFile = useCallback(
    async (file: File) => {
      // Client-side validation
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        toast({
          title: 'Aina ya faili haijaruhusiwa',
          description: `Faili "${file.name}" haipo kwenye orodha ya aina zinzuruhusiwa.`,
          variant: 'destructive',
        });
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        toast({
          title: 'Faili ni kubwa mno',
          description: `Ukubwa wa juu ni ${MAX_FILE_SIZE / (1024 * 1024)}MB. Faili yako ni ${formatFileSize(file.size)}.`,
          variant: 'destructive',
        });
        return;
      }

      try {
        setUploading(true);
        setUploadProgress(0);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('category', selectedCategory);
        formData.append('orgUnitId', String(orgUnitId));
        if (transactionId) {
          formData.append('transactionId', String(transactionId));
        }

        const token = getAuthToken();

        // Use XMLHttpRequest for progress tracking
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/uploads');
          xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
          if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          }

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              setUploadProgress(pct);
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              try {
                const errData = JSON.parse(xhr.responseText);
                reject(new Error(errData.error || 'Hitilafu ya kupakia'));
              } catch {
                reject(new Error('Hitilafu ya kupakia faili'));
              }
            }
          };

          xhr.onerror = () => reject(new Error('Hitilafu ya mtandao'));
          xhr.send(formData);
        });

        toast({
          title: 'Faili imepakiwa',
          description: `"${file.name}" imepakiwa kikamilifu.`,
        });

        // Refresh the list
        await fetchAttachments();
      } catch (err: any) {
        toast({
          title: 'Hitilafu ya kupakia',
          description: err.message || 'Imeshindwa kupakia faili.',
          variant: 'destructive',
        });
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [selectedCategory, orgUnitId, transactionId, fetchAttachments, toast]
  );

  // ============================================================
  // Download file
  // ============================================================

  const downloadFile = useCallback(
    async (attachment: AttachmentRecord) => {
      try {
        const token = getAuthToken();
        const res = await fetch(`/api/uploads/${attachment.id}`, {
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Hitilafu ya mtandao' }));
          throw new Error(err.error || 'Hitilafu ya kupakua');
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = attachment.fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } catch (err: any) {
        toast({
          title: 'Hitilafu ya kupakua',
          description: err.message || 'Imeshindwa kupakua faili.',
          variant: 'destructive',
        });
      }
    },
    [toast]
  );

  // ============================================================
  // Delete file
  // ============================================================

  const deleteFile = useCallback(
    async (attachment: AttachmentRecord) => {
      try {
        const token = getAuthToken();
        const res = await fetch(`/api/uploads/${attachment.id}`, {
          method: 'DELETE',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Hitilafu ya mtandao' }));
          throw new Error(err.error || 'Hitilafu ya kufuta');
        }

        toast({
          title: 'Faili imefutwa',
          description: `"${attachment.fileName}" imefutwa kikamilifu.`,
        });

        await fetchAttachments();
      } catch (err: any) {
        toast({
          title: 'Hitilafu ya kufuta',
          description: err.message || 'Imeshindwa kufuta faili.',
          variant: 'destructive',
        });
      } finally {
        setDeleteTarget(null);
      }
    },
    [fetchAttachments, toast]
  );

  // ============================================================
  // Drag & Drop handlers
  // ============================================================

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      files.forEach((file) => uploadFile(file));
    },
    [uploadFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      files.forEach((file) => uploadFile(file));
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [uploadFile]
  );

  // ============================================================
  // Render
  // ============================================================

  return (
    <Card className="border-emerald-200/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-emerald-900">
          <Paperclip className="h-4 w-4 text-emerald-600" />
          Viambatisho
          {attachments.length > 0 && (
            <Badge
              variant="secondary"
              className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs"
            >
              {attachments.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Upload Zone */}
        <div className="space-y-3">
          {/* Category Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600">Aina:</span>
            <Select
              value={selectedCategory}
              onValueChange={setSelectedCategory}
              disabled={uploading}
            >
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`
              relative cursor-pointer rounded-lg border-2 border-dashed p-6 text-center
              transition-all duration-200
              ${
                isDragOver
                  ? 'border-emerald-500 bg-emerald-50/80 scale-[1.01]'
                  : 'border-slate-300 bg-slate-50/50 hover:border-emerald-400 hover:bg-emerald-50/30'
              }
              ${uploading ? 'pointer-events-none opacity-60' : ''}
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ALLOWED_MIME_TYPES.join(',')}
              onChange={handleFileSelect}
              className="hidden"
            />

            {uploading ? (
              <div className="space-y-3">
                <Loader2 className="h-8 w-8 text-emerald-600 animate-spin mx-auto" />
                <p className="text-sm font-medium text-emerald-700">
                  Inapakia... {uploadProgress}%
                </p>
                <Progress value={uploadProgress} className="h-2 max-w-xs mx-auto" />
              </div>
            ) : (
              <div className="space-y-2">
                <Upload
                  className={`h-8 w-8 mx-auto ${
                    isDragOver ? 'text-emerald-600' : 'text-slate-400'
                  }`}
                />
                <p className="text-sm font-medium text-slate-600">
                  {isDragOver
                    ? 'Weka faili hapa'
                    : 'Buruta na uweke faili hapa'}
                </p>
                <p className="text-xs text-slate-400">
                  au bonyeza kuchagua faili
                </p>
                <p className="text-xs text-slate-400">
                  JpeG, PNG, GIF, WebP, PDF, Excel, TXT · Max 10MB
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 p-3">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-2 text-xs text-red-600 hover:text-red-800"
              onClick={fetchAttachments}
            >
              Jaribu tena
            </Button>
          </div>
        )}

        {/* Attachments List */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 bg-slate-100 rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : attachments.length === 0 ? (
          <div className="text-center py-6">
            <File className="h-10 w-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">Hakuna viambatisho</p>
            <p className="text-xs text-slate-400 mt-1">
              Pakia risiti, vocha, au nyaraka nyingine
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-96 scrollbar-thin scrollbar-thumb-emerald-200 scrollbar-track-transparent">
            <div className="space-y-1">
              {attachments.map((attachment, index) => {
                const FileIcon = getFileIcon(attachment.fileType);
                return (
                  <React.Fragment key={attachment.id}>
                    {index > 0 && <Separator className="my-1" />}
                    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors group">
                      {/* File Icon */}
                      <div className="shrink-0 w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                        <FileIcon className="h-4 w-4 text-emerald-600" />
                      </div>

                      {/* File Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {attachment.fileName}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 h-4 ${
                              CATEGORY_COLORS[attachment.category] ||
                              CATEGORY_COLORS.other
                            }`}
                          >
                            {getCategoryLabel(attachment.category)}
                          </Badge>
                          <span className="text-xs text-slate-400">
                            {formatFileSize(attachment.fileSize)}
                          </span>
                          <span className="text-xs text-slate-400">
                            {formatDate(attachment.createdAt)}
                          </span>
                          {attachment.uploader && (
                            <span className="text-xs text-slate-400">
                              · {attachment.uploader.fullName}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50"
                          onClick={() => downloadFile(attachment)}
                          title="Pakua"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setDeleteTarget(attachment)}
                          title="Futa"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {/* Summary */}
        {attachments.length > 0 && (
          <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
            <span>
              Jumla: {attachments.length} faili
            </span>
            <span>
              {formatFileSize(
                attachments.reduce((sum, a) => sum + a.fileSize, 0)
              )}
            </span>
          </div>
        )}
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Thibitisha Kufuta</AlertDialogTitle>
            <AlertDialogDescription>
              Una uhakika unataka kufuta faili{' '}
              <span className="font-semibold text-slate-900">
                &ldquo;{deleteTarget?.fileName}&rdquo;
              </span>
              ? Kitendo hiki hakiwezi kurudishwa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-200">
              Ghairi
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deleteTarget && deleteFile(deleteTarget)}
            >
              Futa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
