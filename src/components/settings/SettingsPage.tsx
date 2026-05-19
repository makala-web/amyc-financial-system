'use client';

import { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { db, hashPassword, verifyPassword } from '@/lib/db-offline';
import { useAuthStore } from '@/lib/store';
import type { Transaction, ImportBatch, Note } from '@/lib/types';
import { validatePasswordStrength } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  User,
  Lock,
  Info,
  Database,
  Download,
  Upload,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Shield,
  FileSpreadsheet,
  Save,
  RefreshCw,
  PenLine,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  exportBackupAsFile,
  exportEncryptedBackupAsFile,
  importBackupFromFile,
  restoreBackup,
  getBackupTimestamp,
  saveBackupToLocal,
} from '@/lib/backup';
import type { BackupData } from '@/lib/backup';
import SyncStatus from '@/components/settings/SyncStatus';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ============================================================
// SettingsPage Component
// ============================================================

export default function SettingsPage() {
  const { currentUser, currentOrg } = useAuthStore();

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Data management state
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [dataMessage, setDataMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Leader names state
  const [mudirName, setMudirName] = useState(currentOrg?.mudirName || '');
  const [mudirSignature, setMudirSignature] = useState(currentOrg?.mudirSignature || '');
  const [mwekahazinaName, setMwekahazinaName] = useState(currentOrg?.mwekahazinaName || '');
  const [mwekahazinaSignature, setMwekahazinaSignature] = useState(
    currentOrg?.mwekahazinaSignature || '',
  );
  const [isSavingNames, setIsSavingNames] = useState(false);
  const [namesMessage, setNamesMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Backup state
  const [lastBackupTime, setLastBackupTime] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [pendingBackupData, setPendingBackupData] = useState<BackupData | null>(null);
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);

  // Sync leader names when currentOrg changes
  useEffect(() => {
    if (currentOrg) {
      setMudirName(currentOrg.mudirName || '');
      setMudirSignature(currentOrg.mudirSignature || '');
      setMwekahazinaName(currentOrg.mwekahazinaName || '');
      setMwekahazinaSignature(currentOrg.mwekahazinaSignature || '');
    }
  }, [
    currentOrg?.mudirName,
    currentOrg?.mudirSignature,
    currentOrg?.mwekahazinaName,
    currentOrg?.mwekahazinaSignature,
  ]);

  // Load backup timestamp on mount
  useEffect(() => {
    const ts = getBackupTimestamp();
    if (ts) setLastBackupTime(new Date(ts).toLocaleString('sw-TZ'));
  }, []);

  // ============================================================
  // Backup Handlers
  // ============================================================

  const handleCreateBackup = async () => {
    setBackupLoading(true);
    try {
      await saveBackupToLocal();
      const ts = getBackupTimestamp();
      setLastBackupTime(ts ? new Date(ts).toLocaleString('sw-TZ') : 'Hivi karibuni');
      toast.success('Backup imeundwa kikamilifu!');
    } catch {
      toast.error('Hitilafu katika kuunda backup');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleDownloadBackup = async () => {
    setBackupLoading(true);
    try {
      await exportBackupAsFile();
      toast.success('Backup imepagua kikamilifu!');
    } catch {
      toast.error('Hitilafu katika kupakua backup');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleDownloadEncryptedBackup = async () => {
    const passphrase = window.prompt('Weka nenosiri la encrypted backup (herufi 8 au zaidi).');
    if (!passphrase) return;

    setBackupLoading(true);
    try {
      await exportEncryptedBackupAsFile(passphrase);
      toast.success('Encrypted backup imepakuliwa kikamilifu!');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Hitilafu katika kupakua encrypted backup');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleImportBackupClick = async () => {
    try {
      const data = await importBackupFromFile();
      setPendingBackupData(data);
      setConfirmRestoreOpen(true);
    } catch {
      toast.error('Hitilafu katika kusoma faili la backup');
    }
  };

  const handleRestoreBackup = async () => {
    if (!pendingBackupData) return;
    setBackupLoading(true);
    try {
      await restoreBackup(pendingBackupData);
      toast.success('Backup imerejeshwa kikamilifu! Tafadhali anza upya app.');
      setPendingBackupData(null);
      setConfirmRestoreOpen(false);
    } catch {
      toast.error('Hitilafu katika kurejesha backup');
    } finally {
      setBackupLoading(false);
    }
  };

  // ============================================================
  // Save Leader Names
  // ============================================================

  const handleSaveLeaderNames = async () => {
    if (!currentOrg?.id) return;
    setIsSavingNames(true);
    setNamesMessage(null);
    try {
      const updatedOrg = {
        ...currentOrg,
        mudirName: mudirName.trim(),
        mudirSignature: mudirSignature.trim(),
        mwekahazinaName: mwekahazinaName.trim(),
        mwekahazinaSignature: mwekahazinaSignature.trim(),
        updatedAt: new Date().toISOString(),
      };
      await db.orgUnits.update(currentOrg.id, updatedOrg);
      // Update the auth store so the names are available everywhere immediately
      useAuthStore.getState().updateOrg(updatedOrg);
      setNamesMessage({
        type: 'success',
        text: 'Majina na sahihi za viongozi zimehifadhiwa kikamilifu!',
      });
      toast.success('Majina na sahihi za viongozi zimehifadhiwa!');
    } catch (error) {
      setNamesMessage({ type: 'error', text: `Hitilafu: ${String(error)}` });
    } finally {
      setIsSavingNames(false);
    }
  };

  // ============================================================
  // Change Password
  // ============================================================

  const handleChangePassword = async () => {
    if (!currentUser?.id) return;
    setPasswordMessage(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Jaza sehemu zote' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Nenosiri jipya halilingani' });
      return;
    }

    const strengthCheck = validatePasswordStrength(newPassword);
    if (!strengthCheck.valid) {
      setPasswordMessage({ type: 'error', text: strengthCheck.errors.join('. ') });
      return;
    }

    setIsChangingPassword(true);

    try {
      // Verify current password
      const user = await db.users.get(currentUser.id);
      if (!user) {
        setPasswordMessage({ type: 'error', text: 'Mtumiaji hakupatikana' });
        setIsChangingPassword(false);
        return;
      }

      const isMatch = await verifyPassword(currentPassword, user.password);
      if (!isMatch) {
        setPasswordMessage({ type: 'error', text: 'Nenosiri la sasa si sahihi' });
        setIsChangingPassword(false);
        return;
      }

      // Update password
      const newHash = await hashPassword(newPassword);
      await db.users.update(currentUser.id, {
        password: newHash,
        updatedAt: new Date().toISOString(),
      });

      setPasswordMessage({ type: 'success', text: 'Nenosiri limebadilishwa kikamilifu!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setPasswordMessage({ type: 'error', text: `Hitilafu: ${String(error)}` });
    }

    setIsChangingPassword(false);
  };

  // ============================================================
  // Export All Data (Backup)
  // ============================================================

  const handleExportBackup = async () => {
    setIsExporting(true);
    setDataMessage(null);

    try {
      const wb = XLSX.utils.book_new();

      // Transactions sheet
      const transactions = await db.transactions.toArray();
      if (transactions.length > 0) {
        const txnData = transactions.map((t) => ({
          'ID': t.id,
          'Aina': t.type === 'income' ? 'Mapato' : 'Matumizi',
          'Kiasi': t.amount,
          'Tarehe': t.date,
          'Mwezi': t.month,
          'Mwaka': t.year,
          'Idara': t.department,
          'Kategoria': t.category_name,
          'Maelezo': t.description,
          'Chanzo': t.source || '',
          'Muuzaji': t.vendor || '',
          'Idadi': t.quantity || '',
          'Bei@': t.unitPrice || '',
          'Kipimo': t.unit || '',
          'Kitengo': t.orgUnitName,
          'Ngazi': t.orgLevel,
          'Kiliingiza': t.enteredBy,
          'BatchID': t.importBatchId || '',
        }));
        const txnWs = XLSX.utils.json_to_sheet(txnData);
        XLSX.utils.book_append_sheet(wb, txnWs, 'Miamala');
      }

      // Notes sheet
      const notes = await db.notes.toArray();
      if (notes.length > 0) {
        const noteData = notes.map((n) => ({
          'ID': n.id,
          'Kichwa': n.title,
          'Aina': n.type,
          'Maudhui': n.content,
          'KitengoID': n.orgUnitId,
          'Kiliunda': n.createdBy,
          'Tarehe': n.createdAt,
        }));
        const noteWs = XLSX.utils.json_to_sheet(noteData);
        XLSX.utils.book_append_sheet(wb, noteWs, 'Kumbukumbu');
      }

      // Import Batches sheet
      const batches = await db.importBatches.toArray();
      if (batches.length > 0) {
        const batchData = batches.map((b) => ({
          'ID': b.id,
          'Faili': b.fileName,
          'KitengoChaChanzo': b.sourceOrgId,
          'KitengoChaLengo': b.targetOrgId,
          'Aina': b.importType,
          'Rekodi': b.recordCount,
          'Hali': b.status,
          'Kiliingiza': b.importedBy,
          'Tarehe': b.createdAt,
        }));
        const batchWs = XLSX.utils.json_to_sheet(batchData);
        XLSX.utils.book_append_sheet(wb, batchWs, 'BatchZilizopakiwa');
      }

      // Org Units sheet
      const orgUnits = await db.orgUnits.toArray();
      if (orgUnits.length > 0) {
        const orgData = orgUnits.map((o) => ({
          'ID': o.id,
          'Jina': o.name,
          'Aina': o.type,
          'MzaziID': o.parentId || '',
          'Kodi': o.code,
          'Hali': o.isActive ? 'Hai' : 'Haihai',
        }));
        const orgWs = XLSX.utils.json_to_sheet(orgData);
        XLSX.utils.book_append_sheet(wb, orgWs, 'Vitengo');
      }

      // Users sheet
      const users = await db.users.toArray();
      if (users.length > 0) {
        const userData = users.map((u) => ({
          'ID': u.id,
          'JinaLaMtumiaji': u.username,
          'JinaKamili': u.fullName,
          'Nafasi': u.role,
          'Ngazi': u.orgLevel,
          'KitengoID': u.orgUnitId,
          'Hali': u.isActive ? 'Hai' : 'Haihai',
        }));
        const userWs = XLSX.utils.json_to_sheet(userData);
        XLSX.utils.book_append_sheet(wb, userWs, 'Watumiaji');
      }

      const timestamp = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `AMYC_Backup_${timestamp}.xlsx`, {
        bookType: 'xlsx',
        type: 'binary',
      });

      setDataMessage({ type: 'success', text: 'Data imehamishwa kikamilifu!' });
    } catch (error) {
      setDataMessage({ type: 'error', text: `Hitilafu: ${String(error)}` });
    }

    setIsExporting(false);
  };

  // ============================================================
  // Import Backup Data
  // ============================================================

  const handleImportBackup = async (file: File) => {
    setIsImporting(true);
    setDataMessage(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      let importedRecords = 0;

      // Import transactions
      const txnSheet = workbook.Sheets['Miamala'];
      if (txnSheet) {
        const txnData = XLSX.utils.sheet_to_json<Record<string, unknown>>(txnSheet);
        const now = new Date().toISOString();

        for (const row of txnData) {
          await db.transactions.add({
            type: (row['Aina'] === 'Mapato' ? 'income' : 'expense') as 'income' | 'expense',
            amount: Number(row['Kiasi']) || 0,
            date: String(row['Tarehe'] || now.split('T')[0]),
            month: Number(row['Mwezi']) || new Date().getMonth() + 1,
            year: Number(row['Mwaka']) || new Date().getFullYear(),
            department: String(row['Idara'] || 'Daawah') as Transaction['department'],
            categoryId: 0,
            category_name: String(row['Kategoria'] || ''),
            description: String(row['Maelezo'] || ''),
            source: row['Chanzo'] ? String(row['Chanzo']) : undefined,
            vendor: row['Muuzaji'] ? String(row['Muuzaji']) : undefined,
            quantity: row['Idadi'] ? Number(row['Idadi']) : undefined,
            unitPrice: row['Bei@'] ? Number(row['Bei@']) : undefined,
            unit: row['Kipimo'] ? String(row['Kipimo']) : undefined,
            orgUnitId: Number(row['KitengoID'] || 1),
            orgUnitName: String(row['Kitengo'] || 'AMYC'),
            orgLevel: (String(row['Ngazi'] || 'markaz')) as Transaction['orgLevel'],
            enteredBy: Number(row['Kiliingiza'] || 1),
            importBatchId: row['BatchID'] ? Number(row['BatchID']) : undefined,
            createdAt: now,
            updatedAt: now,
          } as Transaction);
          importedRecords++;
        }
      }

      // Import notes
      const noteSheet = workbook.Sheets['Kumbukumbu'];
      if (noteSheet) {
        const noteData = XLSX.utils.sheet_to_json<Record<string, unknown>>(noteSheet);
        const now = new Date().toISOString();

        for (const row of noteData) {
          await db.notes.add({
            title: String(row['Kichwa'] || ''),
            type: (String(row['Aina'] || 'general')) as Note['type'],
            content: String(row['Maudhui'] || ''),
            orgUnitId: Number(row['KitengoID'] || 1),
            createdBy: Number(row['Kiliunda'] || 1),
            createdAt: String(row['Tarehe'] || now),
            updatedAt: now,
          } as Note);
          importedRecords++;
        }
      }

      // Import org units
      const orgSheet = workbook.Sheets['Vitengo'];
      if (orgSheet) {
        const orgData = XLSX.utils.sheet_to_json<Record<string, unknown>>(orgSheet);

        for (const row of orgData) {
          const existing = await db.orgUnits.where('code').equals(String(row['Kodi'] || '')).first();
          if (!existing) {
            await db.orgUnits.add({
              name: String(row['Jina'] || ''),
              type: (String(row['Aina'] || 'tawi')) as 'tawi' | 'jimbo' | 'markaz',
              parentId: row['MzaziID'] ? Number(row['MzaziID']) : null,
              code: String(row['Kodi'] || ''),
              isActive: String(row['Hali']) === 'Hai',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            importedRecords++;
          }
        }
      }

      setDataMessage({
        type: 'success',
        text: `Data imepakiwa kikamilifu! Rekodi ${importedRecords} zimeingizwa.`,
      });
    } catch (error) {
      setDataMessage({ type: 'error', text: `Hitilafu: ${String(error)}` });
    }

    setIsImporting(false);
    if (importFileRef.current) {
      importFileRef.current.value = '';
    }
  };

  // ============================================================
  // Clear All Data
  // ============================================================

  const handleClearData = async () => {
    setIsClearing(true);
    setDataMessage(null);

    try {
      await db.transactions.clear();
      await db.notes.clear();
      await db.importBatches.clear();
      await db.auditLogs.clear();

      setDataMessage({ type: 'success', text: 'Data yote imefutwa kikamilifu!' });
    } catch (error) {
      setDataMessage({ type: 'error', text: `Hitilafu: ${String(error)}` });
    }

    setIsClearing(false);
  };

  // ============================================================
  // Render
  // ============================================================

  const roleLabel = (role: string) => {
    switch (role) {
      case 'admin': return 'Msimamizi Mkuu/ADMIN';
      case 'simple': return 'Mtumiaji';
      case 'mudir': return 'Mudir';
      case 'katibu': return 'Katibu';
      case 'mweka_hazina': return 'Mwekahazina';
      case 'muhasibu': return 'Muhasibu';
      default: return role;
    }
  };

  const orgLevelLabel = (level: string) => {
    switch (level) {
      case 'tawi': return 'Tawi';
      case 'jimbo': return 'Jimbo';
      case 'markaz': return 'Markaz';
      default: return level;
    }
  };

  return (
    <div className="space-y-6">
      <SyncStatus />

      {/* ============================================ */}
      {/* USER PROFILE */}
      {/* ============================================ */}
      <Card className="border-emerald-200 dark:border-emerald-900">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <User className="h-5 w-5" />
            Wasifu
          </CardTitle>
          <CardDescription>Maelezo ya mtumiaji wa sasa</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
          {currentUser && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Jina Kamili</Label>
                <p className="text-sm font-medium">{currentUser.fullName}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Jina la Mtumiaji</Label>
                <p className="text-sm font-medium">{currentUser.username}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Barua Pepe</Label>
                <p className="text-sm font-medium">{currentUser.email || '—'}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Nafasi</Label>
                <p className="text-sm font-medium">{roleLabel(currentUser.role)}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Ngazi</Label>
                <p className="text-sm font-medium">{orgLevelLabel(currentUser.orgLevel)}</p>
              </div>
              {currentOrg && (
                <div>
                  <Label className="text-xs text-muted-foreground">Kitengo</Label>
                  <p className="text-sm font-medium">{currentOrg.name}</p>
                </div>
              )}
              <div>
                <Label className="text-xs text-muted-foreground">Hali</Label>
                <p className="text-sm font-medium">
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {currentUser.isActive ? 'Hai' : 'Haihai'}
                  </span>
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================ */}
      {/* LEADER NAMES (Majina ya Viongozi) */}
      {/* ============================================ */}
      <Card className="border-emerald-200 dark:border-emerald-900">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <PenLine className="h-5 w-5" />
            Majina ya Viongozi
          </CardTitle>
          <CardDescription>
            Jaza majina na sahihi za Mudir na Mwekahazina ili vionekane kwenye ripoti zote za fedha kiotomatiki
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Jina la Mudir (Mkurugenzi)</Label>
              <Input
                placeholder="Ingiza jina la Mudir..."
                value={mudirName}
                onChange={(e) => setMudirName(e.target.value)}
                className="border-emerald-200 dark:border-emerald-800 focus-visible:ring-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Sahihi ya Mudir</Label>
              <Input
                placeholder="Mfano: A. Aweso"
                value={mudirSignature}
                onChange={(e) => setMudirSignature(e.target.value)}
                className="border-emerald-200 dark:border-emerald-800 focus-visible:ring-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Jina la Mwekahazina (Mhasibu)</Label>
              <Input
                placeholder="Ingiza jina la Mwekahazina..."
                value={mwekahazinaName}
                onChange={(e) => setMwekahazinaName(e.target.value)}
                className="border-emerald-200 dark:border-emerald-800 focus-visible:ring-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Sahihi ya Mwekahazina</Label>
              <Input
                placeholder="Mfano: A. Aweso"
                value={mwekahazinaSignature}
                onChange={(e) => setMwekahazinaSignature(e.target.value)}
                className="border-emerald-200 dark:border-emerald-800 focus-visible:ring-emerald-500"
              />
            </div>
          </div>

          {namesMessage && (
            <div
              className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
                namesMessage.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
              }`}
            >
              {namesMessage.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0" />
              )}
              {namesMessage.text}
            </div>
          )}

          <Button
            onClick={handleSaveLeaderNames}
            disabled={isSavingNames || !currentOrg?.id}
            className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white min-h-[44px]"
          >
            {isSavingNames ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Hifadhi Majina na Sahihi
          </Button>

          {currentOrg?.mudirName &&
            currentOrg?.mwekahazinaName &&
            currentOrg?.mudirSignature &&
            currentOrg?.mwekahazinaSignature && (
            <div className="mt-2 p-3 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-100 dark:border-emerald-900 text-xs text-muted-foreground">
              <p>Majina na sahihi zilizohifadhiwa zitaonekana kwenye ripoti zote za fedha (Chapa A4 / Hifadhi PDF) kiotomatiki.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================ */}
      {/* CHANGE PASSWORD */}
      {/* ============================================ */}
      <Card className="border-emerald-200 dark:border-emerald-900">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <Lock className="h-5 w-5" />
            Badilisha Nenosiri
          </CardTitle>
          <CardDescription>Badilisha nenosiri la akaunti yako</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0 space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">Nenosiri la Sasa</Label>
            <Input
              type="password"
              placeholder="Ingiza nenosiri la sasa..."
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Nenosiri Jipya</Label>
            <Input
              type="password"
              placeholder="Ingiza nenosiri jipya..."
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Thibitisha Nenosiri Jipya</Label>
            <Input
              type="password"
              placeholder="Ingiza tena nenosiri jipya..."
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          {passwordMessage && (
            <div
              className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
                passwordMessage.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
              }`}
            >
              {passwordMessage.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0" />
              )}
              {passwordMessage.text}
            </div>
          )}

          <Button
            onClick={handleChangePassword}
            disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword}
            className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white min-h-[44px]"
          >
            {isChangingPassword ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Shield className="h-4 w-4 mr-2" />
            )}
            Badilisha Nenosiri
          </Button>
        </CardContent>
      </Card>

      {/* ============================================ */}
      {/* ABOUT */}
      {/* ============================================ */}
      <Card className="border-emerald-200 dark:border-emerald-900">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <Info className="h-5 w-5" />
            Kuhusu
          </CardTitle>
          <CardDescription>Maelezo kuhusu mfumo</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                <FileSpreadsheet className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">AMYC - Mfumo wa Fedha</h3>
                <p className="text-xs text-muted-foreground">Ansaar Muslim Youth Center</p>
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Toleo:</span>{' '}
                <span className="font-medium">1.0.0</span>
              </div>
              <div>
                <span className="text-muted-foreground">Hifadhi:</span>{' '}
                <span className="font-medium">Nje ya Mtandao (Offline)</span>
              </div>
              <div>
                <span className="text-muted-foreground">Database:</span>{' '}
                <span className="font-medium">IndexedDB (Dexie.js)</span>
              </div>
              <div>
                <span className="text-muted-foreground">Muundo:</span>{' '}
                <span className="font-medium">Tawi / Jimbo / Markaz</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Mfumo huu unatumia hifadhi ya ndani (IndexedDB) ili kuruhusu kazi nje ya mtandao.
              Data yote inahifadhiwa kwenye kifaa chako.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ============================================ */}
      {/* DATA MANAGEMENT */}
      {/* ============================================ */}
      <Card className="border-emerald-200 dark:border-emerald-900">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <Database className="h-5 w-5" />
            Usimamizi wa Data
          </CardTitle>
          <CardDescription>Hamisha, pakia, au futa data ya mfumo</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0 space-y-4">
          {dataMessage && (
            <div
              className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
                dataMessage.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
              }`}
            >
              {dataMessage.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0" />
              )}
              {dataMessage.text}
            </div>
          )}

          <div className="grid gap-3">
            {/* Export Backup */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-100 dark:border-emerald-900">
              <div className="flex items-start gap-3">
                <Download className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Hamisha Data</p>
                  <p className="text-xs text-muted-foreground">
                    Pakua data yote kama faili ya Excel (backup)
                  </p>
                </div>
              </div>
              <Button
                onClick={handleExportBackup}
                disabled={isExporting}
                variant="outline"
                className="w-full sm:w-auto border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30 min-h-[44px]"
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Hamisha
              </Button>
            </div>

            {/* Import Backup */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-100 dark:border-emerald-900">
              <div className="flex items-start gap-3">
                <Upload className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Pakia Data</p>
                  <p className="text-xs text-muted-foreground">
                    Pakia data kutoka faili ya backup ya Excel
                  </p>
                </div>
              </div>
              <div className="shrink-0">
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleImportBackup(e.target.files[0]);
                  }}
                />
                <Button
                  onClick={() => importFileRef.current?.click()}
                  disabled={isImporting}
                  variant="outline"
                  className="w-full sm:w-auto border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30 min-h-[44px]"
                >
                  {isImporting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Pakia
                </Button>
              </div>
            </div>

            {/* Clear Data */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-lg bg-red-50/50 dark:bg-red-950/10 border border-red-100 dark:border-red-900">
              <div className="flex items-start gap-3">
                <Trash2 className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">Futa Data</p>
                  <p className="text-xs text-muted-foreground">
                    Futa data yote ya miamala, kumbukumbu, na batch
                  </p>
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    disabled={isClearing}
                    variant="outline"
                    className="w-full sm:w-auto border-red-300 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30 min-h-[44px]"
                  >
                    {isClearing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-2" />
                    )}
                    Futa Data
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Futa Data Yote?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Kitendo hiki kitaondoa miamala yote, kumbukumbu, na batch zilizopakiwa.
                      Watumiaji na vitengo havitafutwa.
                      Kitendo hiki hakiwezi kurudishwa. Una uhakika?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Ghairi</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleClearData}
                      className="bg-red-600 hover:bg-red-700 text-white"
                    >
                      Ndiyo, Futa
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>
      {/* ============================================ */}
      {/* BACKUP & RESTORE */}
      {/* ============================================ */}
      <Card className="border-emerald-200 dark:border-emerald-900">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-lg text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
            <Shield className="size-5" />
            Hifadhi Nakala (Backup)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Data yako inahifadhiwa moja kwa moja kila dakika 5. Unaweza pia kuunda na kupakua nakala mwenyewe.
          </p>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0 space-y-4">
          {/* Last backup info */}
          <div className="p-3 rounded-lg bg-muted/50 text-sm">
            <p className="font-medium">Nakala ya mwisho: {lastBackupTime || 'Hakuna bado'}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30 min-h-[44px]"
              onClick={handleCreateBackup}
              disabled={backupLoading}
            >
              {backupLoading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
              Unda Backup Sasa
            </Button>
            <Button
              variant="outline"
              className="w-full border-cyan-300 text-cyan-700 hover:bg-cyan-50 dark:border-cyan-800 dark:text-cyan-400 dark:hover:bg-cyan-950/30 min-h-[44px]"
              onClick={handleDownloadBackup}
              disabled={backupLoading}
            >
              <Download className="size-4 mr-2" />
              Lagua Backup (JSON)
            </Button>
            <Button
              variant="outline"
              className="w-full border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-400 dark:hover:bg-violet-950/30 min-h-[44px]"
              onClick={handleDownloadEncryptedBackup}
              disabled={backupLoading}
            >
              <Shield className="size-4 mr-2" />
              Lagua Backup Encrypted
            </Button>
            <Button
              variant="outline"
              className="w-full border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/30 min-h-[44px]"
              onClick={handleImportBackupClick}
              disabled={backupLoading}
            >
              <Upload className="size-4 mr-2" />
              Ingiza Backup kutoka Faili
            </Button>
            <Button
              variant="outline"
              className="w-full border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30 min-h-[44px]"
              onClick={() => {
                // Load from local storage and restore
                const loadAndRestore = async () => {
                  try {
                    const { loadBackupFromLocal } = await import('@/lib/backup');
                    const data = await loadBackupFromLocal();
                    if (data) {
                      setPendingBackupData(data);
                      setConfirmRestoreOpen(true);
                    } else {
                      toast.error('Hakuna backup iliyopatikana');
                    }
                  } catch {
                    toast.error('Hitilafu katika kupakia backup');
                  }
                };
                loadAndRestore();
              }}
              disabled={backupLoading}
            >
              <RefreshCw className="size-4 mr-2" />
              Rejesha Backup
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            ⚠️ Rejesha Backup itafuta data yote ya sasa na kuweka data ya backup. Tumia kwa uangalifu.
          </p>
        </CardContent>
      </Card>

      {/* Confirm Restore Dialog */}
      <Dialog open={confirmRestoreOpen} onOpenChange={setConfirmRestoreOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thibitisha Kurejesha Backup</DialogTitle>
            <DialogDescription>
              Kitendo hiki kitaondoa data yote ya sasa na kuweka data ya backup.
              Data ya sasa itapotea kabisa. Una uhakika unataka kuendelea?
            </DialogDescription>
          </DialogHeader>
          {pendingBackupData && (
            <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
              <p><span className="font-medium">Tarehe ya Backup:</span> {new Date(pendingBackupData.timestamp).toLocaleString('sw-TZ')}</p>
              <p><span className="font-medium">Toleo:</span> {pendingBackupData.version}</p>
              <p><span className="font-medium">Miamala:</span> {pendingBackupData.transactions?.length ?? 0}</p>
              <p><span className="font-medium">Watumiaji:</span> {pendingBackupData.users?.length ?? 0}</p>
              <p><span className="font-medium">Kumbukumbu:</span> {pendingBackupData.notes?.length ?? 0}</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setConfirmRestoreOpen(false);
                setPendingBackupData(null);
              }}
            >
              Ghairi
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleRestoreBackup}
              disabled={backupLoading}
            >
              {backupLoading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <RefreshCw className="size-4 mr-2" />}
              Ndiyo, Rejesha
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
