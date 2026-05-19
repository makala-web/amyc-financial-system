'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPut } from '@/lib/api-client';
import { useAuthStore, useFinancialStore } from '@/lib/store';
import { MONTHS, DEPARTMENTS, ORG_LEVEL_CONFIG } from '@/lib/types';
import { canReviewData, canApproveData, canEnterData } from '@/lib/permissions';
import type { UserRole, OrgLevel } from '@/lib/types';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  CheckCircle,
  Clock,
  AlertTriangle,
  XCircle,
  Eye,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileText,
  Send,
  ArrowRight,
  Building2,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================

interface ApprovalSummary {
  entered: number;
  reviewed: number;
  approved: number;
  rejected: number;
  total: number;
}

interface PendingTransaction {
  id: number;
  type: string;
  amount: number;
  date: string;
  month: number;
  year: number;
  department: string;
  categoryName: string;
  description: string | null;
  orgUnitName: string;
  approvalStatus: string;
  enteredByUser?: { id: number; fullName: string; role: string };
  reviewer?: { id: number; fullName: string; role: string };
  reviewedAt?: string;
  reviewNotes?: string;
}

interface ChildSubmission {
  orgUnitId: number;
  orgUnitName: string;
  orgLevel: string;
  code: string;
  isSubmitted: boolean;
  submittedAt: string | null;
  approvalStatus: string;
  totalIncome: number;
  totalExpense: number;
  netBalance: number;
  approvedIncome: number;
  approvedExpense: number;
  transactionCount: number;
}

interface PendingSubmission {
  id: number;
  orgUnitId: number;
  month: number;
  year: number;
  isSubmitted: boolean;
  approvalStatus: string;
  totalIncome: number;
  totalExpense: number;
  netBalance: number;
  orgUnit?: { id: number; name: string; type: string; code: string };
  submitter?: { id: number; fullName: string };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: React.ComponentType<{ className?: string }> }> = {
  entered: { label: 'Imeingizwa', color: 'text-gray-700', bgColor: 'bg-gray-100', icon: Clock },
  reviewed: { label: 'Imehakikiwa', color: 'text-amber-700', bgColor: 'bg-amber-100', icon: Eye },
  approved: { label: 'Imeidhinishwa', color: 'text-emerald-700', bgColor: 'bg-emerald-100', icon: CheckCircle },
  rejected: { label: 'Imekataliwa', color: 'text-red-700', bgColor: 'bg-red-100', icon: XCircle },
};

function formatTZS(val: number): string {
  return new Intl.NumberFormat('sw-TZ', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
}

// ============================================================
// Component
// ============================================================

export default function ApprovalWorkflow() {
  const { currentOrg, currentUser } = useAuthStore();
  const { selectedYear, selectedMonth, setSelectedMonth } = useFinancialStore();

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'flow' | 'submissions'>('pending');
  const [summary, setSummary] = useState<ApprovalSummary | null>(null);
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransaction[]>([]);
  const [rejectedTransactions, setRejectedTransactions] = useState<PendingTransaction[]>([]);
  const [pendingSubmissions, setPendingSubmissions] = useState<PendingSubmission[]>([]);
  const [childSubmissions, setChildSubmissions] = useState<ChildSubmission[]>([]);

  // Action dialog
  const [actionDialog, setActionDialog] = useState<{
    open: boolean;
    type: 'review' | 'approve' | 'reject';
    entityType: 'transaction' | 'submission';
    entityId: number;
    entityDesc: string;
  }>({ open: false, type: 'review', entityType: 'transaction', entityId: 0, entityDesc: '' });
  const [actionNotes, setActionNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  const orgLevel = currentOrg?.type as OrgLevel | undefined;
  const role = currentUser?.role as UserRole | undefined;
  const orgId = currentOrg?.id;
  const isConsolidated = orgLevel === 'jimbo' || orgLevel === 'markaz';

  const loadData = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const response = await apiGet<{
        data: {
          summary: ApprovalSummary;
          pendingTransactions: PendingTransaction[];
          rejectedTransactions: PendingTransaction[];
          pendingSubmissions: PendingSubmission[];
          childSubmissions: ChildSubmission[] | null;
          userCapabilities: { canReview: boolean; canApprove: boolean; canEnterData: boolean };
        };
      }>('/api/approvals', {
        orgUnitId: orgId,
        month: selectedMonth,
        year: selectedYear,
        includeChildren: isConsolidated,
      });

      setSummary(response.data.summary);
      setPendingTransactions(response.data.pendingTransactions);
      setRejectedTransactions(response.data.rejectedTransactions);
      setPendingSubmissions(response.data.pendingSubmissions);
      if (response.data.childSubmissions) {
        setChildSubmissions(response.data.childSubmissions);
      }
    } catch (err) {
      console.error('Error loading approval data:', err);
      toast.error('Imeshindwa kupata taarifa za uidhinishaji');
    } finally {
      setLoading(false);
    }
  }, [orgId, selectedMonth, selectedYear, isConsolidated]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle approval/review/reject action
  const handleAction = async () => {
    setProcessing(true);
    try {
      const endpoint = actionDialog.entityType === 'transaction'
        ? `/api/transactions/${actionDialog.entityId}`
        : `/api/submissions/${actionDialog.entityId}`;

      await apiPut(endpoint, {
        approvalAction: actionDialog.type,
        notes: actionNotes,
        rejectionReason: actionDialog.type === 'reject' ? actionNotes : undefined,
      });

      toast.success(
        actionDialog.type === 'review'
          ? 'Taarifa zimehakikiwa kwa mafanikio'
          : actionDialog.type === 'approve'
          ? 'Taarifa zimeidhinishwa kwa mafanikio'
          : 'Taarifa zimekataliwa'
      );

      setActionDialog({ open: false, type: 'review', entityType: 'transaction', entityId: 0, entityDesc: '' });
      setActionNotes('');
      loadData();
    } catch (err) {
      toast.error('Imeshindwa kufanya kitendo. Jaribu tena.');
    } finally {
      setProcessing(false);
    }
  };

  const canReview = role ? canReviewData(role) : false;
  const canApprove = role ? canApproveData(role) : false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center">
            <CheckCircle className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-amber-800">Uidhinishaji wa Taarifa</h2>
            <p className="text-sm text-muted-foreground">
              {currentOrg?.name} &middot; {MONTHS[selectedMonth - 1]} {selectedYear}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
            <SelectTrigger className="w-[130px] h-8 text-sm border-amber-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={loadData} className="border-amber-300 text-amber-700 hover:bg-amber-50">
            <RefreshCw className="size-4 mr-1" />
            Oanisha
          </Button>
        </div>
      </div>

      {/* Approval Flow Explanation */}
      <Card className="border-amber-200 bg-amber-50/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-medium text-amber-700">Mfumo wa Uidhinishaji</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge className="bg-gray-100 text-gray-700 border-gray-200">
              <Clock className="h-3 w-3 mr-1" /> Muhasibu anaingiza
            </Badge>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Badge className="bg-amber-100 text-amber-700 border-amber-200">
              <Eye className="h-3 w-3 mr-1" /> Mweka Hazina anahakiki
            </Badge>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
              <ThumbsUp className="h-3 w-3 mr-1" /> Mudir anaidhinisha
            </Badge>
            {isConsolidated && (
              <>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <Badge className="bg-purple-100 text-purple-700 border-purple-200">
                  <Send className="h-3 w-3 mr-1" /> Inapelekwa {orgLevel === 'jimbo' ? 'Markaz' : 'Kitaifa'}
                </Badge>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-gray-200 bg-gray-50/30">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-600 font-medium">Zimeingizwa</p>
                  <p className="text-xl font-bold text-gray-800">{summary.entered}</p>
                </div>
                <Clock className="h-5 w-5 text-gray-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-amber-200 bg-amber-50/30">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-amber-600 font-medium">Zimehakikiwa</p>
                  <p className="text-xl font-bold text-amber-800">{summary.reviewed}</p>
                </div>
                <Eye className="h-5 w-5 text-amber-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-emerald-200 bg-emerald-50/30">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-emerald-600 font-medium">Zimeidhinishwa</p>
                  <p className="text-xl font-bold text-emerald-800">{summary.approved}</p>
                </div>
                <CheckCircle className="h-5 w-5 text-emerald-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-red-200 bg-red-50/30">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-red-600 font-medium">Zimekataliwa</p>
                  <p className="text-xl font-bold text-red-800">{summary.rejected}</p>
                </div>
                <XCircle className="h-5 w-5 text-red-400" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList>
          <TabsTrigger value="pending" className="data-[state=active]:bg-amber-100 data-[state=active]:text-amber-700">
            Inayosubiri ({pendingTransactions.length})
          </TabsTrigger>
          {isConsolidated && (
            <TabsTrigger value="flow" className="data-[state=active]:bg-amber-100 data-[state=active]:text-amber-700">
              Mtiririko wa Matawi
            </TabsTrigger>
          )}
          <TabsTrigger value="submissions" className="data-[state=active]:bg-amber-100 data-[state=active]:text-amber-700">
            Mawasilisho ({pendingSubmissions.length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Pending Transactions Tab */}
      {activeTab === 'pending' && (
        <Card className="border-amber-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-amber-700 flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Taarifa Zinazosubiri Uidhinishaji
            </CardTitle>
            <CardDescription>
              Taarifa ambazo bado hazijahakikiwa au kuidhinishwa
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : pendingTransactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <CheckCircle className="h-12 w-12 mb-3 opacity-20" />
                <p className="font-medium">Hakuna taarifa zinazosubiri</p>
                <p className="text-xs mt-1">Taarifa zote zimeshahakikiwa na kuidhinishwa</p>
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-emerald-200 scrollbar-track-transparent">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gradient-to-r from-amber-700 to-amber-800 hover:from-amber-700 hover:to-amber-800">
                      <TableHead className="text-white font-semibold">Tarehe</TableHead>
                      <TableHead className="text-white font-semibold">Aina</TableHead>
                      <TableHead className="text-white font-semibold">Kundi</TableHead>
                      <TableHead className="text-white font-semibold">Idara</TableHead>
                      <TableHead className="text-white font-semibold text-right">Kiasi</TableHead>
                      <TableHead className="text-white font-semibold">Hali</TableHead>
                      <TableHead className="text-white font-semibold text-right">Vitendo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingTransactions.map((txn) => {
                      const statusInfo = STATUS_CONFIG[txn.approvalStatus] || STATUS_CONFIG.entered;
                      const StatusIcon = statusInfo.icon;
                      return (
                        <TableRow key={txn.id} className="hover:bg-amber-50/30 transition-colors">
                          <TableCell className="text-xs whitespace-nowrap">
                            {new Date(txn.date).toLocaleDateString('sw-TZ', { day: '2-digit', month: 'short' })}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={
                              txn.type === 'income'
                                ? 'bg-emerald-100 text-emerald-700 text-[10px]'
                                : 'bg-orange-100 text-orange-700 text-[10px]'
                            }>
                              {txn.type === 'income' ? 'Mapato' : 'Matumizi'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{txn.categoryName}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{txn.department}</TableCell>
                          <TableCell className={`text-right font-semibold text-xs ${txn.type === 'income' ? 'text-emerald-600' : 'text-orange-600'}`}>
                            {txn.type === 'income' ? '+' : '-'}{formatTZS(txn.amount)}
                          </TableCell>
                          <TableCell>
                            <Badge className={`${statusInfo.bgColor} ${statusInfo.color} text-[10px]`}>
                              <StatusIcon className="h-3 w-3 mr-1" />
                              {statusInfo.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {/* Review button - for 'entered' status */}
                              {txn.approvalStatus === 'entered' && canReview && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-[10px] border-amber-300 text-amber-700 hover:bg-amber-50"
                                  onClick={() => setActionDialog({
                                    open: true,
                                    type: 'review',
                                    entityType: 'transaction',
                                    entityId: txn.id,
                                    entityDesc: `${txn.type === 'income' ? 'Mapato' : 'Matumizi'}: ${formatTZS(txn.amount)} - ${txn.categoryName}`,
                                  })}
                                >
                                  <Eye className="h-3 w-3 mr-1" />
                                  Hakiki
                                </Button>
                              )}
                              {/* Approve button - for 'reviewed' status */}
                              {txn.approvalStatus === 'reviewed' && canApprove && (
                                <Button
                                  size="sm"
                                  className="h-7 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white"
                                  onClick={() => setActionDialog({
                                    open: true,
                                    type: 'approve',
                                    entityType: 'transaction',
                                    entityId: txn.id,
                                    entityDesc: `${txn.type === 'income' ? 'Mapato' : 'Matumizi'}: ${formatTZS(txn.amount)} - ${txn.categoryName}`,
                                  })}
                                >
                                  <ThumbsUp className="h-3 w-3 mr-1" />
                                  Idhinisha
                                </Button>
                              )}
                              {/* Reject button */}
                              {(txn.approvalStatus === 'entered' || txn.approvalStatus === 'reviewed') && (canReview || canApprove) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-[10px] border-red-300 text-red-700 hover:bg-red-50"
                                  onClick={() => setActionDialog({
                                    open: true,
                                    type: 'reject',
                                    entityType: 'transaction',
                                    entityId: txn.id,
                                    entityDesc: `${txn.type === 'income' ? 'Mapato' : 'Matumizi'}: ${formatTZS(txn.amount)} - ${txn.categoryName}`,
                                  })}
                                >
                                  <ThumbsDown className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Child Flow Tab (Jimbo/Markaz only) */}
      {activeTab === 'flow' && isConsolidated && (
        <Card className="border-amber-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg text-amber-700 flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Mtiririko wa {orgLevel === 'jimbo' ? 'Matawi' : 'Majimbo'}
                </CardTitle>
                <CardDescription>
                  {MONTHS[selectedMonth - 1]} {selectedYear} &mdash; Taarifa kutoka {orgLevel === 'jimbo' ? 'matawi' : 'majimbo'} yaliyowasilishwa
                </CardDescription>
              </div>
              <Badge variant={childSubmissions.every(c => c.approvalStatus === 'approved') ? 'default' : 'destructive'} className="text-xs">
                {childSubmissions.filter(c => c.approvalStatus === 'approved').length}/{childSubmissions.length} zimeidhinishwa
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : childSubmissions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Building2 className="h-12 w-12 mb-3 opacity-20" />
                <p className="font-medium">Hakuna {orgLevel === 'jimbo' ? 'matawi' : 'majimbo'} yaliyosajiliwa</p>
              </div>
            ) : (
              <div className="space-y-3">
                {childSubmissions.map((child) => {
                  const statusInfo = STATUS_CONFIG[child.approvalStatus] || STATUS_CONFIG.entered;
                  const StatusIcon = statusInfo.icon;
                  return (
                    <div
                      key={child.orgUnitId}
                      className={`p-4 rounded-lg border transition-colors ${
                        child.approvalStatus === 'approved'
                          ? 'border-emerald-200 bg-emerald-50/30'
                          : child.approvalStatus === 'reviewed'
                          ? 'border-amber-200 bg-amber-50/30'
                          : 'border-gray-200 bg-gray-50/30'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <StatusIcon className={`h-5 w-5 ${statusInfo.color}`} />
                          <div>
                            <p className="text-sm font-medium">{child.orgUnitName}</p>
                            <p className="text-[11px] text-muted-foreground">{child.code} &middot; {child.transactionCount} shughuli</p>
                          </div>
                        </div>
                        <Badge className={`${statusInfo.bgColor} ${statusInfo.color} text-[10px]`}>
                          {statusInfo.label}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-3 mt-3">
                        <div className="text-center p-2 bg-white/50 rounded">
                          <p className="text-[10px] text-muted-foreground">Mapato</p>
                          <p className="text-sm font-bold text-emerald-600">{formatTZS(child.totalIncome)}</p>
                          {child.approvedIncome > 0 && child.approvedIncome !== child.totalIncome && (
                            <p className="text-[9px] text-emerald-500">Imeidhinishwa: {formatTZS(child.approvedIncome)}</p>
                          )}
                        </div>
                        <div className="text-center p-2 bg-white/50 rounded">
                          <p className="text-[10px] text-muted-foreground">Matumizi</p>
                          <p className="text-sm font-bold text-orange-600">{formatTZS(child.totalExpense)}</p>
                          {child.approvedExpense > 0 && child.approvedExpense !== child.totalExpense && (
                            <p className="text-[9px] text-orange-500">Imeidhinishwa: {formatTZS(child.approvedExpense)}</p>
                          )}
                        </div>
                        <div className="text-center p-2 bg-white/50 rounded">
                          <p className="text-[10px] text-muted-foreground">Salio</p>
                          <p className={`text-sm font-bold ${child.netBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {formatTZS(child.netBalance)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Consolidation Summary */}
                <div className="mt-4 p-4 bg-gradient-to-r from-amber-50 to-amber-100/50 rounded-lg border border-amber-200">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-amber-800">Muhtasari wa Umoja</h4>
                    <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-700">
                      {MONTHS[selectedMonth - 1]} {selectedYear}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Jumla Mapato</p>
                      <p className="text-lg font-bold text-emerald-600">
                        {formatTZS(childSubmissions.reduce((s, c) => s + c.totalIncome, 0))}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Jumla Matumizi</p>
                      <p className="text-lg font-bold text-orange-600">
                        {formatTZS(childSubmissions.reduce((s, c) => s + c.totalExpense, 0))}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Jumla Salio</p>
                      <p className={`text-lg font-bold ${
                        childSubmissions.reduce((s, c) => s + c.netBalance, 0) >= 0
                          ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {formatTZS(childSubmissions.reduce((s, c) => s + c.netBalance, 0))}
                      </p>
                    </div>
                  </div>
                  {isConsolidated && childSubmissions.some(c => c.approvalStatus === 'approved') && (
                    <div className="mt-3 pt-3 border-t border-amber-200">
                      <Button
                        className="bg-amber-600 hover:bg-amber-700 text-white text-sm"
                        onClick={async () => {
                          try {
                            await apiPut(`/api/submissions/${pendingSubmissions[0]?.id || 0}`, {
                              approvalAction: 'submit',
                              notes: 'Mawasilisho ya pamoja',
                            });
                            toast.success('Mawasilisho yametumwa kwa Markaz');
                            loadData();
                          } catch {
                            toast.error('Imeshindwa kutuma mawasilisho');
                          }
                        }}
                      >
                        <Send className="h-4 w-4 mr-2" />
                        Wasilisha kwa {orgLevel === 'jimbo' ? 'Markaz' : 'Kitaifa'}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Submissions Tab */}
      {activeTab === 'submissions' && (
        <Card className="border-amber-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-amber-700 flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Mawasilisho ya Kila Mwezi
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : pendingSubmissions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mb-3 opacity-20" />
                <p className="font-medium">Hakuna mawasilisho yaliyosubiri</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingSubmissions.map((sub) => {
                  const statusInfo = STATUS_CONFIG[sub.approvalStatus] || STATUS_CONFIG.entered;
                  const StatusIcon = statusInfo.icon;
                  return (
                    <div
                      key={sub.id}
                      className="flex items-center justify-between p-4 rounded-lg border border-amber-100 bg-amber-50/20 hover:bg-amber-50/40 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <StatusIcon className={`h-5 w-5 ${statusInfo.color}`} />
                        <div>
                          <p className="text-sm font-medium">
                            {sub.orgUnit?.name || 'Kitengo'} &mdash; {MONTHS[sub.month - 1]} {sub.year}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Mapato: {formatTZS(sub.totalIncome)} &middot; Matumizi: {formatTZS(sub.totalExpense)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`${statusInfo.bgColor} ${statusInfo.color} text-[10px]`}>
                          {statusInfo.label}
                        </Badge>
                        {sub.approvalStatus === 'entered' && canReview && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] border-amber-300 text-amber-700"
                            onClick={() => setActionDialog({
                              open: true,
                              type: 'review',
                              entityType: 'submission',
                              entityId: sub.id,
                              entityDesc: `Mawasilisho: ${sub.orgUnit?.name || ''} - ${MONTHS[sub.month - 1]} ${sub.year}`,
                            })}
                          >
                            <Eye className="h-3 w-3 mr-1" />
                            Hakiki
                          </Button>
                        )}
                        {sub.approvalStatus === 'reviewed' && canApprove && (
                          <Button
                            size="sm"
                            className="h-7 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={() => setActionDialog({
                              open: true,
                              type: 'approve',
                              entityType: 'submission',
                              entityId: sub.id,
                              entityDesc: `Mawasilisho: ${sub.orgUnit?.name || ''} - ${MONTHS[sub.month - 1]} ${sub.year}`,
                            })}
                          >
                            <ThumbsUp className="h-3 w-3 mr-1" />
                            Idhinisha
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Action Dialog */}
      <Dialog open={actionDialog.open} onOpenChange={(open) => {
        if (!open) {
          setActionDialog({ ...actionDialog, open: false });
          setActionNotes('');
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className={
              actionDialog.type === 'approve'
                ? 'text-emerald-700'
                : actionDialog.type === 'reject'
                ? 'text-red-700'
                : 'text-amber-700'
            }>
              {actionDialog.type === 'review'
                ? 'Hakiki Taarifa'
                : actionDialog.type === 'approve'
                ? 'Idhinisha Taarifa'
                : 'Kataa Taarifa'}
            </DialogTitle>
            <DialogDescription>
              {actionDialog.entityDesc}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                {actionDialog.type === 'reject' ? 'Sababu ya kukataa' : 'Maelezo (si lazima)'}
              </label>
              <Textarea
                placeholder={
                  actionDialog.type === 'reject'
                    ? 'Eleza kwa nini unakataa...'
                    : 'Ongeza maelezo yako...'
                }
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                className="mt-1"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setActionDialog({ ...actionDialog, open: false });
                setActionNotes('');
              }}
              disabled={processing}
            >
              Ghairi
            </Button>
            <Button
              className={
                actionDialog.type === 'approve'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : actionDialog.type === 'reject'
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-amber-600 hover:bg-amber-700 text-white'
              }
              onClick={handleAction}
              disabled={processing || (actionDialog.type === 'reject' && !actionNotes.trim())}
            >
              {processing ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-1" />
              ) : actionDialog.type === 'approve' ? (
                <ThumbsUp className="h-4 w-4 mr-1" />
              ) : actionDialog.type === 'reject' ? (
                <ThumbsDown className="h-4 w-4 mr-1" />
              ) : (
                <Eye className="h-4 w-4 mr-1" />
              )}
              {actionDialog.type === 'review'
                ? 'Hakiki'
                : actionDialog.type === 'approve'
                ? 'Idhinisha'
                : 'Kataa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
