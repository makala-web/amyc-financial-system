'use client';

import { useEffect, useState, useCallback } from 'react';
import { db } from '@/lib/db-offline';
import { useAuthStore, useFinancialStore } from '@/lib/store';
import { DEPARTMENTS, MONTHS, MONTHS_SHORT } from '@/lib/types';
import type { Budget, BudgetItem, Transaction } from '@/lib/types';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import {
  TrendingUp, TrendingDown, BarChart3, PieChart as PieChartIcon,
  Target, AlertTriangle, ArrowUpRight, ArrowDownRight, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

interface BudgetAnalysisProps {
  budgetId?: number | null;
  onBack?: () => void;
}

const CHART_COLORS = ['#10b981', '#f59e0b', '#6366f1', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export default function BudgetAnalysis({ budgetId, onBack }: BudgetAnalysisProps) {
  const { currentOrg } = useAuthStore();
  const { selectedYear } = useFinancialStore();

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [selectedBudgetId, setSelectedBudgetId] = useState<number | null>(budgetId || null);
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'overview' | 'monthly' | 'departmental' | 'categories'>('overview');

  // Load budgets for selection
  useEffect(() => {
    async function loadBudgets() {
      if (!currentOrg) return;
      const allBudgets = await db.budgets
        .where('orgUnitId')
        .equals(currentOrg.id!)
        .toArray();
      const filtered = allBudgets.filter(b => b.year === selectedYear);
      setBudgets(filtered);
      if (!selectedBudgetId && filtered.length > 0) {
        setSelectedBudgetId(filtered[0].id!);
      }
    }
    loadBudgets();
  }, [currentOrg, selectedYear, selectedBudgetId]);

  // Load budget items and actual transactions
  const loadAnalysisData = useCallback(async () => {
    if (!currentOrg || !selectedBudgetId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const items = await db.budgetItems.where('budgetId').equals(selectedBudgetId).toArray();
      setBudgetItems(items);

      const allTxns = await db.transactions
        .where('orgUnitId')
        .equals(currentOrg.id!)
        .toArray();
      const filtered = allTxns.filter(t => t.year === selectedYear);
      setTransactions(filtered);
    } catch (err) {
      console.error('Error loading analysis:', err);
      toast.error('Hitilafu katika kupakia data');
    } finally {
      setLoading(false);
    }
  }, [currentOrg, selectedBudgetId, selectedYear]);

  useEffect(() => {
    loadAnalysisData();
  }, [loadAnalysisData]);

  // Calculate actuals for a budget item
  const getActualAmount = (item: BudgetItem): number => {
    const matching = transactions.filter(t => {
      if (t.type !== item.type) return false;
      if (t.categoryId !== item.categoryId) return false;
      if (t.department !== item.department) return false;
      if (item.month !== null && t.month !== item.month) return false;
      return true;
    });
    return matching.reduce((sum, t) => sum + t.amount, 0);
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('sw-TZ', { style: 'decimal', minimumFractionDigits: 0 }).format(val);

  // ===== ANALYSIS COMPUTATIONS =====

  // Overall budget vs actual
  const budget = budgets.find(b => b.id === selectedBudgetId);
  const totalIncomeBudget = budgetItems.filter(i => i.type === 'income').reduce((s, i) => s + i.budgetAmount, 0);
  const totalExpenseBudget = budgetItems.filter(i => i.type === 'expense').reduce((s, i) => s + i.budgetAmount, 0);
  const totalIncomeActual = budgetItems.filter(i => i.type === 'income').reduce((s, i) => s + getActualAmount(i), 0);
  const totalExpenseActual = budgetItems.filter(i => i.type === 'expense').reduce((s, i) => s + getActualAmount(i), 0);

  const incomeVariance = totalIncomeActual - totalIncomeBudget;
  const expenseVariance = totalExpenseActual - totalExpenseBudget;
  const incomeVariancePct = totalIncomeBudget > 0 ? (incomeVariance / totalIncomeBudget) * 100 : 0;
  const expenseVariancePct = totalExpenseBudget > 0 ? (expenseVariance / totalExpenseBudget) * 100 : 0;

  // Monthly comparison data
  const monthlyComparisonData = MONTHS_SHORT.map((monthName, monthIndex) => {
    const month = monthIndex + 1;
    const monthBudgetItems = budgetItems.filter(i => i.month === null || i.month === month);
    const incomeBudget = monthBudgetItems.filter(i => i.type === 'income').reduce((s, i) => {
      if (i.month === month) return s + i.budgetAmount;
      return s + i.budgetAmount / 12; // distribute annual items evenly
    }, 0);
    const expenseBudget = monthBudgetItems.filter(i => i.type === 'expense').reduce((s, i) => {
      if (i.month === month) return s + i.budgetAmount;
      return s + i.budgetAmount / 12;
    }, 0);

    const monthTxns = transactions.filter(t => t.month === month);
    const incomeActual = monthTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expenseActual = monthTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

    return {
      name: monthName,
      'Bajeti Mapato': Math.round(incomeBudget),
      'Halisi Mapato': incomeActual,
      'Bajeti Matumizi': Math.round(expenseBudget),
      'Halisi Matumizi': expenseActual,
    };
  });

  // Departmental analysis
  const departmentalData = DEPARTMENTS.map(dept => {
    const deptItems = budgetItems.filter(i => i.department === dept);
    const deptBudget = deptItems.reduce((s, i) => s + i.budgetAmount, 0);
    const deptActual = deptItems.reduce((s, i) => s + getActualAmount(i), 0);
    const variance = deptActual - deptBudget;
    const variancePct = deptBudget > 0 ? (variance / deptBudget) * 100 : 0;

    return {
      name: dept.length > 12 ? dept.substring(0, 12) + '...' : dept,
      fullName: dept,
      bajeti: deptBudget,
      halisi: deptActual,
      tofauti: variance,
      tofautiPct: variancePct,
    };
  }).filter(d => d.bajeti > 0 || d.halisi > 0);

  // Category analysis
  const categoryAnalysis = budgetItems.map(item => {
    const actual = getActualAmount(item);
    const variance = actual - item.budgetAmount;
    const variancePct = item.budgetAmount > 0 ? (variance / item.budgetAmount) * 100 : 0;
    return {
      ...item,
      actual,
      variance,
      variancePct,
    };
  }).sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct));

  // Variance alerts (items with significant variance)
  const alerts = categoryAnalysis.filter(item =>
    Math.abs(item.variancePct) > 10 && item.budgetAmount > 0
  );

  // Pie chart data for budget allocation
  const budgetAllocationData = budgetItems
    .reduce((acc, item) => {
      const existing = acc.find(a => a.name === item.category_name);
      if (existing) {
        existing.value += item.budgetAmount;
      } else {
        acc.push({ name: item.category_name, value: item.budgetAmount, type: item.type });
      }
      return acc;
    }, [] as { name: string; value: number; type: string }[])
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  if (loading && budgetItems.length === 0) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (!selectedBudgetId || budgets.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex flex-col items-center justify-center text-muted-foreground">
            <BarChart3 className="size-12 mb-3 opacity-40" />
            <p className="text-lg font-medium">Hakuna bajeti ya kuchambua</p>
            <p className="text-sm mt-1">Unda bajeti kwanza ili kuona uchambuzi</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Budget Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button variant="outline" size="sm" onClick={onBack} className="border-emerald-300 text-emerald-700">
              ← Rudi
            </Button>
          )}
          <div>
            <h2 className="text-xl font-bold text-emerald-700 flex items-center gap-2">
              <BarChart3 className="size-5" />
              Uchambuzi wa Bajeti
            </h2>
            <p className="text-sm text-muted-foreground">
              {budget?.name || 'Chagua bajeti'} &middot; Mwaka {selectedYear}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(selectedBudgetId)}
            onValueChange={(val) => setSelectedBudgetId(Number(val))}
          >
            <SelectTrigger className="w-[220px] border-emerald-200">
              <SelectValue placeholder="Chagua bajeti" />
            </SelectTrigger>
            <SelectContent>
              {budgets.map(b => (
                <SelectItem key={b.id} value={String(b.id)}>
                  {b.name} ({STATUS_CONFIG_MAP[b.status]})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={loadAnalysisData} className="border-emerald-300">
            <RefreshCw className="size-4 text-emerald-600" />
          </Button>
        </div>
      </div>

      {/* View Mode Tabs */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        {[
          { key: 'overview', label: 'Muhtasari', icon: Target },
          { key: 'monthly', label: 'Kwa Mwezi', icon: BarChart3 },
          { key: 'departmental', label: 'Ki-Idara', icon: PieChartIcon },
          { key: 'categories', label: 'Makundi', icon: TrendingUp },
        ].map(mode => (
          <Button
            key={mode.key}
            variant={viewMode === mode.key ? 'default' : 'ghost'}
            size="sm"
            className={viewMode === mode.key ? 'bg-emerald-600 text-white' : 'text-muted-foreground'}
            onClick={() => setViewMode(mode.key as typeof viewMode)}
          >
            <mode.icon className="size-4 mr-1" />
            {mode.label}
          </Button>
        ))}
      </div>

      {/* ===== OVERVIEW MODE ===== */}
      {viewMode === 'overview' && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-l-4 border-l-green-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-green-700">Bajeti - Mapato</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold text-green-600">TSh {formatCurrency(totalIncomeBudget)}</p>
                <p className="text-xs text-muted-foreground mt-1">Kiasi kilichopangwa</p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-emerald-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-emerald-700">Halisi - Mapato</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold text-emerald-600">TSh {formatCurrency(totalIncomeActual)}</p>
                <div className="flex items-center gap-1 mt-1">
                  {incomeVariance >= 0 ? (
                    <ArrowUpRight className="size-3 text-green-500" />
                  ) : (
                    <ArrowDownRight className="size-3 text-red-500" />
                  )}
                  <span className={`text-xs font-medium ${incomeVariance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {incomeVariancePct >= 0 ? '+' : ''}{incomeVariancePct.toFixed(1)}%
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-orange-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-orange-700">Bajeti - Matumizi</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold text-orange-600">TSh {formatCurrency(totalExpenseBudget)}</p>
                <p className="text-xs text-muted-foreground mt-1">Kiasi kilichopangwa</p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-red-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-red-700">Halisi - Matumizi</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold text-red-600">TSh {formatCurrency(totalExpenseActual)}</p>
                <div className="flex items-center gap-1 mt-1">
                  {expenseVariance <= 0 ? (
                    <ArrowDownRight className="size-3 text-green-500" />
                  ) : (
                    <ArrowUpRight className="size-3 text-red-500" />
                  )}
                  <span className={`text-xs font-medium ${expenseVariance <= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {expenseVariancePct >= 0 ? '+' : ''}{expenseVariancePct.toFixed(1)}%
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Variance Alerts */}
          {alerts.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/30">
              <CardHeader>
                <CardTitle className="text-lg text-amber-700 flex items-center gap-2">
                  <AlertTriangle className="size-5" />
                  Tahadhari za Tofauti ({alerts.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {alerts.slice(0, 5).map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-white/80 border border-amber-100">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={item.type === 'income' ? 'border-green-300 text-green-700' : 'border-orange-300 text-orange-700'}>
                          {item.type === 'income' ? 'Mapato' : 'Matumizi'}
                        </Badge>
                        <span className="text-sm">{item.category_name}</span>
                        <span className="text-xs text-muted-foreground">({item.department})</span>
                      </div>
                      <span className={`text-sm font-semibold ${item.variance > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {item.variance > 0 ? '+' : ''}TSh {formatCurrency(item.variance)} ({item.variancePct.toFixed(1)}%)
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Budget Allocation Pie */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg text-emerald-700">Mgawanyo wa Bajeti</CardTitle>
              </CardHeader>
              <CardContent>
                {budgetAllocationData.length === 0 ? (
                  <div className="flex items-center justify-center h-64 text-muted-foreground">
                    Hakuna data ya mgawanyo
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={budgetAllocationData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }) => `${name.substring(0, 15)} (${(percent * 100).toFixed(0)}%)`}
                      >
                        {budgetAllocationData.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => `TSh ${formatCurrency(value)}`} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Budget vs Actual Summary Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg text-emerald-700">Bajeti vs Halisi - Muhtasari</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Kipengele</TableHead>
                        <TableHead className="text-xs text-right">Bajeti</TableHead>
                        <TableHead className="text-xs text-right">Halisi</TableHead>
                        <TableHead className="text-xs text-right">Tofauti</TableHead>
                        <TableHead className="text-xs text-right">%</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium text-sm text-green-700">Mapato</TableCell>
                        <TableCell className="text-right text-sm">TSh {formatCurrency(totalIncomeBudget)}</TableCell>
                        <TableCell className="text-right text-sm">TSh {formatCurrency(totalIncomeActual)}</TableCell>
                        <TableCell className={`text-right text-sm font-medium ${incomeVariance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {incomeVariance >= 0 ? '+' : ''}TSh {formatCurrency(incomeVariance)}
                        </TableCell>
                        <TableCell className={`text-right text-sm font-medium ${incomeVariance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {incomeVariancePct >= 0 ? '+' : ''}{incomeVariancePct.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium text-sm text-orange-700">Matumizi</TableCell>
                        <TableCell className="text-right text-sm">TSh {formatCurrency(totalExpenseBudget)}</TableCell>
                        <TableCell className="text-right text-sm">TSh {formatCurrency(totalExpenseActual)}</TableCell>
                        <TableCell className={`text-right text-sm font-medium ${expenseVariance <= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {expenseVariance >= 0 ? '+' : ''}TSh {formatCurrency(expenseVariance)}
                        </TableCell>
                        <TableCell className={`text-right text-sm font-medium ${expenseVariance <= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {expenseVariancePct >= 0 ? '+' : ''}{expenseVariancePct.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                      <TableRow className="bg-muted/50 font-semibold">
                        <TableCell className="text-sm">Salio</TableCell>
                        <TableCell className="text-right text-sm">TSh {formatCurrency(totalIncomeBudget - totalExpenseBudget)}</TableCell>
                        <TableCell className="text-right text-sm">TSh {formatCurrency(totalIncomeActual - totalExpenseActual)}</TableCell>
                        <TableCell className={`text-right text-sm ${((totalIncomeActual - totalExpenseActual) - (totalIncomeBudget - totalExpenseBudget)) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          TSh {formatCurrency((totalIncomeActual - totalExpenseActual) - (totalIncomeBudget - totalExpenseBudget))}
                        </TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* ===== MONTHLY MODE ===== */}
      {viewMode === 'monthly' && (
        <div className="space-y-4">
          {/* Income Monthly Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg text-emerald-700">Mapato: Bajeti vs Halisi kwa Mwezi</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyComparisonData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number) => `TSh ${formatCurrency(value)}`}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
                  />
                  <Legend />
                  <Bar dataKey="Bajeti Mapato" fill="#86efac" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Halisi Mapato" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Expense Monthly Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg text-orange-700">Matumizi: Bajeti vs Halisi kwa Mwezi</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyComparisonData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number) => `TSh ${formatCurrency(value)}`}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
                  />
                  <Legend />
                  <Bar dataKey="Bajeti Matumizi" fill="#fdba74" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Halisi Matumizi" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Monthly Detailed Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg text-emerald-700">Jedwali la Kila Mwezi</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Mwezi</TableHead>
                      <TableHead className="text-xs text-right">Bajeti Mapato</TableHead>
                      <TableHead className="text-xs text-right">Halisi Mapato</TableHead>
                      <TableHead className="text-xs text-right">Tofauti</TableHead>
                      <TableHead className="text-xs text-right">Bajeti Matumizi</TableHead>
                      <TableHead className="text-xs text-right">Halisi Matumizi</TableHead>
                      <TableHead className="text-xs text-right">Tofauti</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthlyComparisonData.map((row, idx) => {
                      const incVar = row['Halisi Mapato'] - row['Bajeti Mapato'];
                      const expVar = row['Halisi Matumizi'] - row['Bajeti Matumizi'];
                      return (
                        <TableRow key={idx}>
                          <TableCell className="font-medium text-sm">{row.name}</TableCell>
                          <TableCell className="text-right text-sm text-green-600">{formatCurrency(row['Bajeti Mapato'])}</TableCell>
                          <TableCell className="text-right text-sm text-green-700">{formatCurrency(row['Halisi Mapato'])}</TableCell>
                          <TableCell className={`text-right text-sm font-medium ${incVar >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {incVar >= 0 ? '+' : ''}{formatCurrency(incVar)}
                          </TableCell>
                          <TableCell className="text-right text-sm text-orange-600">{formatCurrency(row['Bajeti Matumizi'])}</TableCell>
                          <TableCell className="text-right text-sm text-orange-700">{formatCurrency(row['Halisi Matumizi'])}</TableCell>
                          <TableCell className={`text-right text-sm font-medium ${expVar <= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {expVar >= 0 ? '+' : ''}{formatCurrency(expVar)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===== DEPARTMENTAL MODE ===== */}
      {viewMode === 'departmental' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg text-emerald-700">Bajeti vs Halisi - Ki-Idara</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={departmentalData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-15} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number) => `TSh ${formatCurrency(value)}`}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
                  />
                  <Legend />
                  <Bar dataKey="bajeti" name="Bajeti" fill="#86efac" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="halisi" name="Halisi" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Departmental Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg text-emerald-700">Jedwali la Idara</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Idara</TableHead>
                      <TableHead className="text-xs text-right">Bajeti</TableHead>
                      <TableHead className="text-xs text-right">Halisi</TableHead>
                      <TableHead className="text-xs text-right">Tofauti</TableHead>
                      <TableHead className="text-xs text-right">%</TableHead>
                      <TableHead className="text-xs text-right">Hali</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {departmentalData.map((dept, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium text-sm">{dept.fullName}</TableCell>
                        <TableCell className="text-right text-sm">TSh {formatCurrency(dept.bajeti)}</TableCell>
                        <TableCell className="text-right text-sm">TSh {formatCurrency(dept.halisi)}</TableCell>
                        <TableCell className={`text-right text-sm font-medium ${dept.tofauti >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {dept.tofauti >= 0 ? '+' : ''}TSh {formatCurrency(dept.tofauti)}
                        </TableCell>
                        <TableCell className={`text-right text-sm font-medium ${dept.tofautiPct <= 10 ? 'text-green-600' : 'text-red-600'}`}>
                          {dept.tofautiPct >= 0 ? '+' : ''}{dept.tofautiPct.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant="outline"
                            className={
                              Math.abs(dept.tofautiPct) <= 10
                                ? 'border-green-300 text-green-700'
                                : Math.abs(dept.tofautiPct) <= 25
                                ? 'border-amber-300 text-amber-700'
                                : 'border-red-300 text-red-700'
                            }
                          >
                            {Math.abs(dept.tofautiPct) <= 10 ? 'Sawa' : Math.abs(dept.tofautiPct) <= 25 ? 'Onyo' : 'Hatari'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===== CATEGORIES MODE ===== */}
      {viewMode === 'categories' && (
        <div className="space-y-4">
          {/* Category Detail Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg text-emerald-700">Uchambuzi wa Kila Kundi</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Aina</TableHead>
                      <TableHead className="text-xs">Kundi</TableHead>
                      <TableHead className="text-xs">Idara</TableHead>
                      <TableHead className="text-xs">Kipindi</TableHead>
                      <TableHead className="text-xs text-right">Bajeti</TableHead>
                      <TableHead className="text-xs text-right">Halisi</TableHead>
                      <TableHead className="text-xs text-right">Tofauti</TableHead>
                      <TableHead className="text-xs text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryAnalysis.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={item.type === 'income' ? 'border-green-300 text-green-700' : 'border-orange-300 text-orange-700'}
                          >
                            {item.type === 'income' ? 'Mapato' : 'Matumizi'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-medium">{item.category_name}</TableCell>
                        <TableCell className="text-sm">{item.department}</TableCell>
                        <TableCell className="text-sm">{item.month ? MONTHS[item.month - 1] : 'Mwaka'}</TableCell>
                        <TableCell className="text-right text-sm">TSh {formatCurrency(item.budgetAmount)}</TableCell>
                        <TableCell className="text-right text-sm">TSh {formatCurrency(item.actual)}</TableCell>
                        <TableCell className={`text-right text-sm font-medium ${item.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {item.variance >= 0 ? '+' : ''}TSh {formatCurrency(item.variance)}
                        </TableCell>
                        <TableCell className={`text-right text-sm font-medium ${
                          Math.abs(item.variancePct) <= 10 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {item.variancePct >= 0 ? '+' : ''}{item.variancePct.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Top Over/Under Budget Items */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg text-green-700 flex items-center gap-2">
                  <TrendingUp className="size-5" />
                  Zaidi ya Bajeti (Mapato)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {categoryAnalysis.filter(i => i.type === 'income' && i.variance > 0).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Hakuna mapato zaidi ya bajeti</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {categoryAnalysis
                      .filter(i => i.type === 'income' && i.variance > 0)
                      .sort((a, b) => b.variance - a.variance)
                      .slice(0, 5)
                      .map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-green-50 border border-green-100">
                          <div>
                            <p className="text-sm font-medium">{item.category_name}</p>
                            <p className="text-xs text-muted-foreground">{item.department}</p>
                          </div>
                          <span className="text-sm font-semibold text-green-600">+TSh {formatCurrency(item.variance)}</span>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg text-red-700 flex items-center gap-2">
                  <TrendingDown className="size-5" />
                  Zaidi ya Bajeti (Matumizi)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {categoryAnalysis.filter(i => i.type === 'expense' && i.variance > 0).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Hakuna matumizi zaidi ya bajeti</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {categoryAnalysis
                      .filter(i => i.type === 'expense' && i.variance > 0)
                      .sort((a, b) => b.variance - a.variance)
                      .slice(0, 5)
                      .map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-red-50 border border-red-100">
                          <div>
                            <p className="text-sm font-medium">{item.category_name}</p>
                            <p className="text-xs text-muted-foreground">{item.department}</p>
                          </div>
                          <span className="text-sm font-semibold text-red-600">+TSh {formatCurrency(item.variance)}</span>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_CONFIG_MAP: Record<string, string> = {
  draft: 'Rasimu',
  approved: 'Imeidhinishwa',
  revision: 'Marekebisho',
  rejected: 'Imekataliwa',
};
