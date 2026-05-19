'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ClipboardList,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Filter,
  Calendar,
  Search,
  Loader2,
  Shield,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================================
// Types
// ============================================================

interface AuditLogEntry {
  id: number;
  action: string;
  entity: string;
  entityId: number;
  userId: number;
  details: string;
  oldValues?: string | null;
  newValues?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  user?: {
    id: number;
    fullName: string;
    email: string;
    role: string;
  } | null;
}

interface AuditFilters {
  actions: string[];
  entities: string[];
}

// ============================================================
// Action color/badge config
// ============================================================

const ACTION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  create: { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-800 dark:text-emerald-300', label: 'Kuunda' },
  update: { bg: 'bg-sky-100 dark:bg-sky-900/40', text: 'text-sky-800 dark:text-sky-300', label: 'Kuhariri' },
  delete: { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-800 dark:text-red-300', label: 'Kufuta' },
  approve: { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-800 dark:text-amber-300', label: 'Kuidhinisha' },
  reject: { bg: 'bg-rose-100 dark:bg-rose-900/40', text: 'text-rose-800 dark:text-rose-300', label: 'Kukataa' },
  login: { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-800 dark:text-blue-300', label: 'Kuingia' },
  logout: { bg: 'bg-slate-100 dark:bg-slate-900/40', text: 'text-slate-800 dark:text-slate-300', label: 'Kutoka' },
  deactivate: { bg: 'bg-rose-100 dark:bg-rose-900/40', text: 'text-rose-800 dark:text-rose-300', label: 'Kusitisha' },
  activate: { bg: 'bg-teal-100 dark:bg-teal-900/40', text: 'text-teal-800 dark:text-teal-300', label: 'Kuwasha' },
  import: { bg: 'bg-violet-100 dark:bg-violet-900/40', text: 'text-violet-800 dark:text-violet-300', label: 'Kupakia' },
  export: { bg: 'bg-sky-100 dark:bg-sky-900/40', text: 'text-sky-800 dark:text-sky-300', label: 'Kuhamisha' },
  submit: { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-800 dark:text-emerald-300', label: 'Kuwasilisha' },
  review: { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-800 dark:text-amber-300', label: 'Kukagua' },
  reversal: { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-800 dark:text-orange-300', label: 'Kurudisha' },
};

const DEFAULT_ACTION_STYLE = { bg: 'bg-gray-100 dark:bg-gray-900/40', text: 'text-gray-800 dark:text-gray-300', label: '' };

const ENTITY_LABELS: Record<string, string> = {
  transaction: 'Muamala',
  user: 'Mtumiaji',
  orgUnit: 'Kitengo',
  category: 'Kategoria',
  note: 'Kumbukumbu',
  submission: 'Wasilisho',
  budget: 'Bajeti',
  approvalStep: 'Hatua ya Idhini',
  notification: 'Arifa',
  system: 'Mfumo',
  session: 'Kipindi',
};

// ============================================================
// Helpers
// ============================================================

function formatDateDetailed(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('sw-TZ', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatTimeAgo(iso: string): string {
  try {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diff = now - then;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Sasa hivi';
    if (minutes < 60) return `Dakika ${minutes} zilizopita`;
    if (hours < 24) return `Masaa ${hours} yaliyopita`;
    if (days < 7) return `Siku ${days} zilizopita`;
    return formatDateDetailed(iso);
  } catch {
    return iso;
  }
}

function parseValues(valuesStr: string | null | undefined): Record<string, unknown> | null {
  if (!valuesStr) return null;
  try {
    return JSON.parse(valuesStr);
  } catch {
    return null;
  }
}

// ============================================================
// Component
// ============================================================

export default function AuditDashboard() {
  // State
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Filters
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [userSearch, setUserSearch] = useState<string>('');

  // Filter options from API
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [availableEntities, setAvailableEntities] = useState<string[]>([]);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 25;

  // ============================================================
  // Fetch audit logs
  // ============================================================

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number | undefined> = {
        page,
        limit,
      };

      if (actionFilter !== 'all') params.action = actionFilter;
      if (entityFilter !== 'all') params.entity = entityFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;

      const result = await apiGet<{
        data: AuditLogEntry[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
        filters: AuditFilters;
      }>('/api/audit', params);

      let filteredData = result.data || [];

      // Client-side user search filter (API doesn't support user name search)
      if (userSearch.trim()) {
        const q = userSearch.toLowerCase();
        filteredData = filteredData.filter((log) => {
          const userName = log.user?.fullName?.toLowerCase() || '';
          const userEmail = log.user?.email?.toLowerCase() || '';
          const details = log.details?.toLowerCase() || '';
          return userName.includes(q) || userEmail.includes(q) || details.includes(q);
        });
      }

      setLogs(filteredData);
      setTotalPages(result.pagination?.totalPages || 1);
      setTotal(result.pagination?.total || 0);

      // Set available filter options
      if (result.filters) {
        if (result.filters.actions?.length) setAvailableActions(result.filters.actions);
        if (result.filters.entities?.length) setAvailableEntities(result.filters.entities);
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      toast.error('Imeshindwa kupata kumbukumbu za ukaguzi');
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, entityFilter, dateFrom, dateTo, userSearch]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [actionFilter, entityFilter, dateFrom, dateTo]);

  // ============================================================
  // Render
  // ============================================================

  const getActionBadge = (action: string) => {
    const style = ACTION_STYLES[action] || DEFAULT_ACTION_STYLE;
    return (
      <Badge variant="outline" className={`${style.bg} ${style.text} border-0 font-medium text-xs`}>
        {style.label || action}
      </Badge>
    );
  };

  const getEntityLabel = (entity: string): string => {
    return ENTITY_LABELS[entity] || entity;
  };

  const renderChangeRow = (log: AuditLogEntry) => {
    const oldVals = parseValues(log.oldValues);
    const newVals = parseValues(log.newValues);

    if (!oldVals && !newVals) {
      // Try parsing details for old/new values
      return null;
    }

    const allKeys = Array.from(new Set([
      ...Object.keys(oldVals || {}),
      ...Object.keys(newVals || {}),
    ]));

    return (
      <TableRow className="bg-emerald-50/50 dark:bg-emerald-950/20">
        <TableCell colSpan={6} className="p-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider mb-2">
              Mabadiliko ya Thamani
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {allKeys.map((key) => (
                <div key={key} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground min-w-[120px] truncate">{key}:</span>
                  <span className="text-red-600 dark:text-red-400 line-through truncate max-w-[150px]">
                    {oldVals?.[key] !== undefined ? String(oldVals[key]) : '—'}
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400 truncate max-w-[150px]">
                    {newVals?.[key] !== undefined ? String(newVals[key]) : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className="space-y-4">
      {/* Filter Card */}
      <Card className="border-emerald-100 dark:border-emerald-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
            <Filter className="h-5 w-5" />
            Vichujio vya Ukaguzi
          </CardTitle>
          <CardDescription>Chuja kumbukumbu kwa aina ya kitendo, kitengo, tarehe, au mtumiaji</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Action filter */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Aina ya Kitendo</Label>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="border-emerald-200 text-sm">
                  <SelectValue placeholder="Vitendo Vyote" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Vitendo Vyote</SelectItem>
                  {availableActions.map((action) => (
                    <SelectItem key={action} value={action}>
                      {ACTION_STYLES[action]?.label || action}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Entity filter */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Aina ya Kitu</Label>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="border-emerald-200 text-sm">
                  <SelectValue placeholder="Vitu Vyote" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Vitu Vyote</SelectItem>
                  {availableEntities.map((entity) => (
                    <SelectItem key={entity} value={entity}>
                      {getEntityLabel(entity)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date from */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Tarehe Kutoka
              </Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="border-emerald-200 text-sm"
              />
            </div>

            {/* Date to */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Tarehe Hadi
              </Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="border-emerald-200 text-sm"
              />
            </div>

            {/* User search */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Tafuta Mtumiaji</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Jina au barua pepe..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="pl-8 border-emerald-200 text-sm"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-muted-foreground">
              Inaonyesha {logs.length} kati ya {total} kumbukumbu
              {totalPages > 1 && ` · Ukurasa ${page} wa ${totalPages}`}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={fetchLogs}
              disabled={loading}
              className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 h-7 text-xs"
            >
              {loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              Pakia tena
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Audit Log Table - Bank Statement Style */}
      <Card className="border-emerald-100 dark:border-emerald-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
            <Shield className="h-5 w-5" />
            Kumbukumbu za Ukaguzi
          </CardTitle>
          <CardDescription>Rekodi zote za shughuli za mfumo kwa ajili ya uchunguzi</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {/* Loading skeleton */}
          {loading && (
            <div className="p-4 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          )}

          {/* Table */}
          {!loading && (
            <ScrollArea className="max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-emerald-800 hover:bg-emerald-800">
                    <TableHead className="text-emerald-100 font-semibold w-10" />
                    <TableHead className="text-emerald-100 font-semibold">Tarehe/Saa</TableHead>
                    <TableHead className="text-emerald-100 font-semibold">Mtumiaji</TableHead>
                    <TableHead className="text-emerald-100 font-semibold">Kitendo</TableHead>
                    <TableHead className="text-emerald-100 font-semibold">Kitu</TableHead>
                    <TableHead className="text-emerald-100 font-semibold">Maelezo</TableHead>
                    <TableHead className="text-emerald-100 font-semibold">IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        <ClipboardList className="h-10 w-10 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">Hakuna kumbukumbu za ukaguzi</p>
                        <p className="text-xs mt-1">Badilisha vichujio ili kuona kumbukumbu</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((log) => {
                      const hasChanges = log.oldValues || log.newValues;
                      const isExpanded = expandedRow === log.id;
                      const changeRow = isExpanded && hasChanges ? renderChangeRow(log) : null;

                      return (
                        <>
                          <TableRow
                            key={log.id}
                            className={`hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors cursor-pointer ${
                              isExpanded ? 'bg-emerald-50/30 dark:bg-emerald-950/10' : ''
                            }`}
                            onClick={() => setExpandedRow(isExpanded ? null : log.id)}
                          >
                            <TableCell className="w-10">
                              {hasChanges ? (
                                <button className="p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900 rounded">
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4 text-emerald-700" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-emerald-700" />
                                  )}
                                </button>
                              ) : (
                                <span className="inline-block w-5" />
                              )}
                            </TableCell>
                            <TableCell className="text-xs whitespace-nowrap">
                              <div>
                                <p className="text-muted-foreground">{formatDateDetailed(log.createdAt)}</p>
                                <p className="text-[10px] text-muted-foreground/60">{formatTimeAgo(log.createdAt)}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              {log.user ? (
                                <div className="min-w-0">
                                  <p className="text-xs font-medium truncate max-w-[120px]">{log.user.fullName}</p>
                                  <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">{log.user.email}</p>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">Mtumiaji #{log.userId}</span>
                              )}
                            </TableCell>
                            <TableCell>{getActionBadge(log.action)}</TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-0.5">
                                <Badge variant="outline" className="text-[10px] w-fit border-emerald-200 dark:border-emerald-800">
                                  {getEntityLabel(log.entity)}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground font-mono">#{log.entityId}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs max-w-[250px]">
                              <p className="truncate">{log.details}</p>
                            </TableCell>
                            <TableCell className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                              {log.ipAddress || '—'}
                            </TableCell>
                          </TableRow>
                          {changeRow}
                        </>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>

        {/* Pagination footer */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-emerald-100 dark:border-emerald-900">
            <p className="text-xs text-muted-foreground">
              Ukurasa {page} wa {totalPages} · Jumla {total} kumbukumbu
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="h-7 text-xs border-emerald-200"
              >
                <ArrowLeft className="h-3 w-3 mr-1" />
                Awali
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }
                  return (
                    <Button
                      key={pageNum}
                      size="sm"
                      variant={pageNum === page ? 'default' : 'outline'}
                      onClick={() => setPage(pageNum)}
                      className={`h-7 w-7 p-0 text-xs ${
                        pageNum === page
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'border-emerald-200'
                      }`}
                    >
                      {pageNum}
                    </Button>
                  );
                })}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="h-7 text-xs border-emerald-200"
              >
                Mbele
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
