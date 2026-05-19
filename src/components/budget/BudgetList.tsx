'use client';

import { useEffect, useState, useCallback } from 'react';
import { db } from '@/lib/db-offline';
import { useAuthStore, useFinancialStore } from '@/lib/store';
import { MONTHS } from '@/lib/types';
import type { Budget, BudgetItem, BudgetStatus } from '@/lib/types';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  FileSpreadsheet, Trash2, Pencil, CheckCircle2, XCircle,
  Eye, Search, Filter, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Input } from '@/components/ui/input';

const STATUS_CONFIG: Record<BudgetStatus, { label: string; color: string; bgColor: string }> = {
  draft: { label: 'Rasimu', color: 'text-gray-700', bgColor: 'bg-gray-100' },
  approved: { label: 'Imeidhinishwa', color: 'text-green-700', bgColor: 'bg-green-100' },
  revision: { label: 'Marekebisho', color: 'text-amber-700', bgColor: 'bg-amber-100' },
  rejected: { label: 'Imekataliwa', color: 'text-red-700', bgColor: 'bg-red-100' },
};

interface BudgetListProps {
  onEdit: (budgetId: number) => void;
  onViewAnalysis: (budgetId: number) => void;
  refreshTrigger?: number;
}

export default function BudgetList({ onEdit, onViewAnalysis, refreshTrigger }: BudgetListProps) {
  const { currentOrg } = useAuthStore();
  const { selectedYear } = useFinancialStore();

  const [budgets, setBudgets] = useState<(Budget & { itemCount: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedBudget, setExpandedBudget] = useState<number | null>(null);
  const [budgetDetails, setBudgetDetails] = useState<Record<number, BudgetItem[]>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteBudgetId, setDeleteBudgetId] = useState<number | null>(null);

  const loadBudgets = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);
    try {
      const allBudgets = await db.budgets
        .where('orgUnitId')
        .equals(currentOrg.id!)
        .toArray();

      const filtered = allBudgets
        .filter(b => b.year === selectedYear)
        .map(async b => {
          const items = await db.budgetItems.where('budgetId').equals(b.id!).toArray();
          return { ...b, itemCount: items.length };
        });

      const results = await Promise.all(filtered);
      setBudgets(results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    } catch (err) {
      console.error('Error loading budgets:', err);
    } finally {
      setLoading(false);
    }
  }, [currentOrg, selectedYear]);

  useEffect(() => {
    loadBudgets();
  }, [loadBudgets, refreshTrigger]);

  const loadBudgetDetails = async (budgetId: number) => {
    if (budgetDetails[budgetId]) return;
    const items = await db.budgetItems.where('budgetId').equals(budgetId).toArray();
    setBudgetDetails(prev => ({ ...prev, [budgetId]: items }));
  };

  const handleToggleExpand = (budgetId: number) => {
    if (expandedBudget === budgetId) {
      setExpandedBudget(null);
    } else {
      setExpandedBudget(budgetId);
      loadBudgetDetails(budgetId);
    }
  };

  const handleApprove = async (budgetId: number) => {
    try {
      await db.budgets.update(budgetId, { status: 'approved', updatedAt: new Date().toISOString() });
      toast.success('Bajeti imeidhinishwa!');
      loadBudgets();
    } catch (err) {
      toast.error('Hitilafu katika kuidhinisha bajeti');
    }
  };

  const handleReject = async (budgetId: number) => {
    try {
      await db.budgets.update(budgetId, { status: 'rejected', updatedAt: new Date().toISOString() });
      toast.success('Bajeti imekataliwa');
      loadBudgets();
    } catch (err) {
      toast.error('Hitilafu katika kukataa bajeti');
    }
  };

  const handleDelete = async () => {
    if (!deleteBudgetId) return;
    try {
      await db.budgetItems.where('budgetId').equals(deleteBudgetId).delete();
      await db.budgets.delete(deleteBudgetId);
      toast.success('Bajeti imefutwa');
      setDeleteDialogOpen(false);
      setDeleteBudgetId(null);
      loadBudgets();
    } catch (err) {
      toast.error('Hitilafu katika kufuta bajeti');
    }
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('sw-TZ', { style: 'decimal', minimumFractionDigits: 0 }).format(val);

  // Filter budgets
  const filteredBudgets = budgets.filter(b => {
    const matchesSearch = b.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tafuta bajeti..."
            className="pl-9 border-emerald-200"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] border-emerald-200">
            <Filter className="size-4 mr-2 text-emerald-600" />
            <SelectValue placeholder="Hali" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Zote</SelectItem>
            <SelectItem value="draft">Rasimu</SelectItem>
            <SelectItem value="approved">Imeidhinishwa</SelectItem>
            <SelectItem value="revision">Marekebisho</SelectItem>
            <SelectItem value="rejected">Imekataliwa</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Budget List */}
      {filteredBudgets.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center text-muted-foreground">
              <FileSpreadsheet className="size-12 mb-3 opacity-40" />
              <p className="text-lg font-medium">
                {searchQuery || statusFilter !== 'all' ? 'Hakuna bajeti inayolingana' : 'Hakuna bajeti bado'}
              </p>
              <p className="text-sm mt-1">
                {searchQuery || statusFilter !== 'all'
                  ? 'Badilisha vichujio kujaribu tena'
                  : 'Unda bajeti mpya kuanza'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredBudgets.map(budget => {
            const statusConfig = STATUS_CONFIG[budget.status];
            const isExpanded = expandedBudget === budget.id;
            const items = budgetDetails[budget.id!] || [];

            return (
              <Card key={budget.id} className="overflow-hidden">
                {/* Budget Header Row */}
                <div
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => handleToggleExpand(budget.id!)}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <FileSpreadsheet className="size-8 text-emerald-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-sm truncate">{budget.name}</h3>
                        <Badge className={`${statusConfig.bgColor} ${statusConfig.color} text-xs`}>
                          {statusConfig.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>Mwaka: {budget.year}</span>
                        <span>&middot;</span>
                        <span>{budget.itemCount} vipengele</span>
                        <span>&middot;</span>
                        <span>{new Date(budget.createdAt).toLocaleDateString('sw-TZ')}</span>
                      </div>
                    </div>
                  </div>

                  {/* Budget Summary */}
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-xs text-green-600">Mapato</p>
                      <p className="text-sm font-semibold text-green-700">TSh {formatCurrency(budget.totalIncomeBudget)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-orange-600">Matumizi</p>
                      <p className="text-sm font-semibold text-orange-700">TSh {formatCurrency(budget.totalExpenseBudget)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Salio</p>
                      <p className={`text-sm font-bold ${budget.totalIncomeBudget - budget.totalExpenseBudget >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        TSh {formatCurrency(budget.totalIncomeBudget - budget.totalExpenseBudget)}
                      </p>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="size-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-5 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t px-4 pb-4">
                    <div className="mt-3 mb-3 flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        onClick={(e) => { e.stopPropagation(); onEdit(budget.id!); }}
                      >
                        <Pencil className="size-3.5 mr-1" />
                        Hariri
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-teal-300 text-teal-700 hover:bg-teal-50"
                        onClick={(e) => { e.stopPropagation(); onViewAnalysis(budget.id!); }}
                      >
                        <Eye className="size-3.5 mr-1" />
                        Uchambuzi
                      </Button>
                      {budget.status === 'draft' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-green-300 text-green-700 hover:bg-green-50"
                            onClick={(e) => { e.stopPropagation(); handleApprove(budget.id!); }}
                          >
                            <CheckCircle2 className="size-3.5 mr-1" />
                            Idhinisha
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-red-300 text-red-700 hover:bg-red-50"
                            onClick={(e) => { e.stopPropagation(); handleReject(budget.id!); }}
                          >
                            <XCircle className="size-3.5 mr-1" />
                            Kataa
                          </Button>
                        </>
                      )}
                      {budget.status === 'revision' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-green-300 text-green-700 hover:bg-green-50"
                          onClick={(e) => { e.stopPropagation(); handleApprove(budget.id!); }}
                        >
                          <CheckCircle2 className="size-3.5 mr-1" />
                          Idhinisha
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-300 text-red-600 hover:bg-red-50 ml-auto"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteBudgetId(budget.id!);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <Trash2 className="size-3.5 mr-1" />
                        Futa
                      </Button>
                    </div>

                    {items.length > 0 ? (
                      <div className="rounded-lg border overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50">
                              <TableHead className="text-xs">Aina</TableHead>
                              <TableHead className="text-xs">Kundi</TableHead>
                              <TableHead className="text-xs">Idara</TableHead>
                              <TableHead className="text-xs">Kipindi</TableHead>
                              <TableHead className="text-xs text-right">Kiasi</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {items.map(item => (
                              <TableRow key={item.id}>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={`text-xs ${
                                      item.type === 'income'
                                        ? 'border-green-300 text-green-700'
                                        : 'border-orange-300 text-orange-700'
                                    }`}
                                  >
                                    {item.type === 'income' ? 'Mapato' : 'Matumizi'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm">{item.category_name}</TableCell>
                                <TableCell className="text-sm">{item.department}</TableCell>
                                <TableCell className="text-sm">
                                  {item.month ? MONTHS[item.month - 1] : 'Mwaka Nzima'}
                                </TableCell>
                                <TableCell className="text-right text-sm font-medium">
                                  TSh {formatCurrency(item.budgetAmount)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">Inapakia...</p>
                    )}

                    {budget.description && (
                      <div className="mt-3 p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Maelezo:</p>
                        <p className="text-sm">{budget.description}</p>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Futa Bajeti?</DialogTitle>
            <DialogDescription>
              Kitendo hiki hakihairishiki. Bajeti na vipengele vyake vyote vitafutwa.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Ghairi
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
            >
              <Trash2 className="size-4 mr-2" />
              Futa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
