'use client';

import { useEffect, useState, useCallback } from 'react';
import { db, getMonthlySummary, getDepartmentalSummary, getChildOrgUnits } from '@/lib/db-offline';
import { calculateOfflinePeriodBalance } from '@/lib/finance/offline-balance-engine';
import { useAuthStore, useFinancialStore, useUIStore } from '@/lib/store';
import { DEPARTMENTS, MONTHS, MONTHS_SHORT } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Wallet, Receipt,
  PlusCircle, MinusCircle, FileText, RefreshCw, Calculator,
  ArrowUpRight, ArrowDownRight, Activity, HandCoins,
} from 'lucide-react';
import type { Transaction } from '@/lib/types';
import type { ConsolidatedReportNineData } from '@/lib/reports/consolidated-report-nine';
import type { BranchReportSnapshot } from '@/lib/exporters/branch-export';

const DEPARTMENT_COLORS = ['#10b981', '#f59e0b', '#6366f1', '#ef4444', '#8b5cf6'];

function parseRegionalReportNine(raw: string | undefined) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ConsolidatedReportNineData;
  } catch {
    return null;
  }
}

function parseBranchSnapshotState(raw: string | undefined) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { branchSnapshots?: Record<string, BranchReportSnapshot> };
  } catch {
    return null;
  }
}

export default function Dashboard() {
  const currentOrg = useAuthStore((s) => s.currentOrg);
  const currentUser = useAuthStore((s) => s.currentUser);
  const selectedYear = useFinancialStore((s) => s.selectedYear);
  const selectedMonth = useFinancialStore((s) => s.selectedMonth);
  const setActiveSection = useUIStore((s) => s.setActiveSection);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [monthlyData, setMonthlyData] = useState<{ name: string; Mapato: number; Matumizi: number }[]>([]);
  const [deptData, setDeptData] = useState<{ name: string; value: number }[]>([]);
  const [budgetData, setBudgetData] = useState<{ totalBudget: number; totalActual: number; budgetCount: number }>({ totalBudget: 0, totalActual: 0, budgetCount: 0 });
  const [totalIncome, setTotalIncome] = useState(0);
  const [totalExpense, setTotalExpense] = useState(0);
  const [continuityData, setContinuityData] = useState({
    currentBalance: 0,
    openingBalance: 0,
    closingBalance: 0,
    carryForward: 0,
    regionalTotal: 0,
    nationalTotal: 0,
  });
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);
    try {
      const orgId = currentOrg.id!;
      const allTxns = await db.transactions
        .where('orgUnitId')
        .equals(orgId)
        .toArray();
      const filtered = allTxns.filter(t => t.year === selectedYear);
      setTransactions(filtered);

      // Summary totals
      const income = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      const expense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      setTotalIncome(income);
      setTotalExpense(expense);

      // Monthly chart data
      const { incomeByMonth, expenseByMonth } = await getMonthlySummary(orgId, selectedYear);
      const mData = MONTHS_SHORT.map((m, i) => ({
        name: m,
        Mapato: incomeByMonth[i],
        Matumizi: expenseByMonth[i],
      }));
      setMonthlyData(mData);

      // Budget data
      const allBudgets = await db.budgets
        .where('orgUnitId')
        .equals(orgId)
        .toArray();
      const yearBudgets = allBudgets.filter(b => b.year === selectedYear);
      const totalBudget = yearBudgets.reduce((s, b) => s + b.totalIncomeBudget + b.totalExpenseBudget, 0);
      setBudgetData({
        totalBudget,
        totalActual: income + expense,
        budgetCount: yearBudgets.length,
      });

      // Department breakdown
      const deptSummary = await getDepartmentalSummary(orgId, selectedYear);
      const dData = DEPARTMENTS.map(dept => {
        const d = deptSummary[dept];
        return { name: dept, value: (d?.income || 0) + (d?.expense || 0) };
      }).filter(d => d.value > 0);
      setDeptData(dData);

      const collectDescendantIds = async (rootId: number): Promise<number[]> => {
        const children = await getChildOrgUnits(rootId);
        const childIds = children.filter((child) => child.isActive).map((child) => child.id!);
        const nestedIds: number[] = [];

        for (const childId of childIds) {
          nestedIds.push(...await collectDescendantIds(childId));
        }

        return [...childIds, ...nestedIds];
      };

      const getRegionSnapshotClosing = async (regionId: number) => {
        const rows = await db.regionalReports.where('unitId').equals(regionId).toArray();
        const candidates = rows
          .filter((r) => r.year === selectedYear && r.reportType === 'consolidated_master')
          .map((r) => parseRegionalReportNine(r.dataJson))
          .filter((r): r is ConsolidatedReportNineData => Boolean(r && r.level === 'jimbo'));

        if (candidates.length === 0) return null;
        if (selectedMonth > 0) {
          const exact = candidates.find((r) => r.month === selectedMonth);
          if (exact) return exact.closingBalance;
          const annual = candidates.find((r) => !r.month || r.month === 0);
          if (annual) return annual.closingBalance;
        }
        const annual = candidates.find((r) => !r.month || r.month === 0);
        if (annual) return annual.closingBalance;
        return candidates.reduce((sum, r) => sum + (r.closingBalance || 0), 0);
      };

      const getJimboBranchSnapshotClosing = async (regionId: number) => {
        const rows = await db.regionalReports.where('unitId').equals(regionId).toArray();
        const yearRows = rows.filter(
          (r) => r.reportType === 'regional' && r.year === selectedYear && (!selectedMonth || r.month === selectedMonth)
        );
        let closing = 0;
        for (const row of yearRows) {
          const parsed = parseBranchSnapshotState(row.dataJson);
          if (!parsed?.branchSnapshots) continue;
          for (const snapshot of Object.values(parsed.branchSnapshots)) {
            closing += snapshot.net || 0;
          }
        }
        return closing;
      };

      const sumClosingBalances = async (orgUnitIds: number[]) => {
        const balances = await Promise.all(
          orgUnitIds.map((id) => calculateOfflinePeriodBalance(id, selectedYear, selectedMonth))
        );
        return balances.reduce((sum, item) => sum + item.closingBalance, 0);
      };

      const currentMonthBalance = await calculateOfflinePeriodBalance(orgId, selectedYear, selectedMonth);
      const descendantIds = await collectDescendantIds(orgId);
      const regionalScope = [orgId, ...descendantIds];
      const activeOrgUnits = await db.orgUnits.where('isActive').equals(1).toArray();

      let regionalTotal = await sumClosingBalances(regionalScope);
      let nationalTotal = await sumClosingBalances(activeOrgUnits.map((unit) => unit.id!));

      if (currentOrg.type === 'jimbo') {
        const branches = (await getChildOrgUnits(orgId)).filter((u) => u.isActive && u.type === 'tawi');
        const snapshotClosing = await getJimboBranchSnapshotClosing(orgId);
        if (snapshotClosing !== 0 && branches.length > 0) {
          regionalTotal = currentMonthBalance.closingBalance + snapshotClosing;
        }
      }

      if (currentOrg.type === 'markaz') {
        const regions = (await getChildOrgUnits(orgId)).filter((u) => u.isActive && u.type === 'jimbo');
        let regionsClosing = 0;
        for (const region of regions) {
          const snapshotClosing = await getRegionSnapshotClosing(region.id!);
          if (snapshotClosing != null) {
            regionsClosing += snapshotClosing;
          } else {
            const regionBal = await calculateOfflinePeriodBalance(region.id!, selectedYear, selectedMonth);
            regionsClosing += regionBal.closingBalance;
          }
        }
        nationalTotal = currentMonthBalance.closingBalance + regionsClosing;
        regionalTotal = nationalTotal;
      }

      setContinuityData({
        currentBalance: currentMonthBalance.totalIncome - currentMonthBalance.totalExpense,
        openingBalance: currentMonthBalance.openingBalance,
        closingBalance: currentMonthBalance.closingBalance,
        carryForward: currentMonthBalance.carryForward,
        regionalTotal,
        nationalTotal,
      });
    } catch (err) {
      console.error('Error loading dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, [currentOrg, selectedYear, selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const balance = totalIncome - totalExpense;
  const recentTransactions = [...transactions]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10);

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('sw-TZ', { style: 'decimal', minimumFractionDigits: 0 }).format(val);

  // Get greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Habari za Asubuhi';
    if (hour < 17) return 'Habari za Mchana';
    return 'Habari za Jioni';
  };

  if (!currentOrg) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Card className="p-8 text-center max-w-md">
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-lg">Tafadhali ingia kuona dashibodi</p>
            <p className="text-muted-foreground text-sm mt-2">Please log in to view the dashboard</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-4">
        <Card className="min-w-0 border-l-4 border-l-green-500 hover:shadow-md transition-all duration-200 group">
          <CardHeader className="flex flex-row items-center justify-between pb-1 p-3 sm:p-5 sm:pb-2">
            <CardTitle className="min-w-0 pr-2 text-[10px] sm:text-xs lg:text-sm leading-snug font-medium text-green-700 break-words">Jumla ya Mapato</CardTitle>
            <div className="rounded-full bg-green-100 p-1.5 sm:p-2 group-hover:scale-110 transition-transform duration-200">
              <TrendingUp className="size-3.5 sm:size-4 text-green-600" />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-5 sm:pt-0">
            {loading ? (
              <div className="h-7 w-28 bg-muted animate-pulse rounded" />
            ) : (
              <>
                <p className="break-words text-base sm:text-xl lg:text-2xl font-bold text-green-600 leading-tight">{formatCurrency(totalIncome)}</p>
                <div className="flex items-start gap-1 mt-1 min-w-0">
                  <ArrowUpRight className="size-3 text-green-500" />
                  <p className="text-[9px] sm:text-[10px] lg:text-xs text-green-600 font-medium leading-snug break-words">Mapato ya Jumla</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 border-l-4 border-l-orange-500 hover:shadow-md transition-all duration-200 group">
          <CardHeader className="flex flex-row items-center justify-between pb-1 p-3 sm:p-5 sm:pb-2">
            <CardTitle className="min-w-0 pr-2 text-[10px] sm:text-xs lg:text-sm leading-snug font-medium text-orange-700 break-words">Jumla ya Matumizi</CardTitle>
            <div className="rounded-full bg-orange-100 p-1.5 sm:p-2 group-hover:scale-110 transition-transform duration-200">
              <TrendingDown className="size-3.5 sm:size-4 text-orange-600" />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-5 sm:pt-0">
            {loading ? (
              <div className="h-7 w-28 bg-muted animate-pulse rounded" />
            ) : (
              <>
                <p className="break-words text-base sm:text-xl lg:text-2xl font-bold text-orange-600 leading-tight">{formatCurrency(totalExpense)}</p>
                <div className="flex items-start gap-1 mt-1 min-w-0">
                  <ArrowDownRight className="size-3 text-orange-500" />
                  <p className="text-[9px] sm:text-[10px] lg:text-xs text-orange-600 font-medium leading-snug break-words">Matumizi ya Jumla</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 border-l-4 border-l-emerald-500 hover:shadow-md transition-all duration-200 group">
          <CardHeader className="flex flex-row items-center justify-between pb-1 p-3 sm:p-5 sm:pb-2">
            <CardTitle className="min-w-0 pr-2 text-[10px] sm:text-xs lg:text-sm leading-snug font-medium text-emerald-700 break-words">Salio</CardTitle>
            <div className="rounded-full bg-emerald-100 p-1.5 sm:p-2 group-hover:scale-110 transition-transform duration-200">
              <HandCoins className="size-3.5 sm:size-4 text-emerald-600" />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-5 sm:pt-0">
            {loading ? (
              <div className="h-7 w-28 bg-muted animate-pulse rounded" />
            ) : (
              <>
                <p className={`break-words text-base sm:text-xl lg:text-2xl font-bold leading-tight ${balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {formatCurrency(balance)}
                </p>
                <p className="text-[9px] sm:text-[10px] lg:text-xs text-muted-foreground mt-1 font-medium leading-snug break-words">Salio Halisi</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 border-l-4 border-l-teal-500 hover:shadow-md transition-all duration-200 group">
          <CardHeader className="flex flex-row items-center justify-between pb-1 p-3 sm:p-5 sm:pb-2">
            <CardTitle className="min-w-0 pr-2 text-[10px] sm:text-xs lg:text-sm leading-snug font-medium text-teal-700 break-words">Idadi ya Shughuli</CardTitle>
            <div className="rounded-full bg-teal-100 p-1.5 sm:p-2 group-hover:scale-110 transition-transform duration-200">
              <Receipt className="size-3.5 sm:size-4 text-teal-600" />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-5 sm:pt-0">
            {loading ? (
              <div className="h-7 w-16 bg-muted animate-pulse rounded" />
            ) : (
              <>
                <p className="break-words text-base sm:text-xl lg:text-2xl font-bold text-teal-600 leading-tight">{transactions.length}</p>
                <p className="text-[9px] sm:text-[10px] lg:text-xs text-muted-foreground mt-1 font-medium leading-snug break-words">Idadi ya Shughuli</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 border-l-4 border-l-cyan-500 cursor-pointer hover:shadow-md transition-all duration-200 group min-[420px]:col-span-2 xl:col-span-1" onClick={() => setActiveSection('budget')}>
          <CardHeader className="flex flex-row items-center justify-between pb-1 p-3 sm:p-5 sm:pb-2">
            <CardTitle className="min-w-0 pr-2 text-[10px] sm:text-xs lg:text-sm leading-snug font-medium text-cyan-700 break-words">Bajeti</CardTitle>
            <div className="rounded-full bg-cyan-100 p-1.5 sm:p-2 group-hover:scale-110 transition-transform duration-200">
              <Calculator className="size-3.5 sm:size-4 text-cyan-600" />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-5 sm:pt-0">
            {loading ? (
              <div className="h-7 w-20 bg-muted animate-pulse rounded" />
            ) : (
              <>
                <p className="break-words text-sm sm:text-base lg:text-lg font-bold text-cyan-600 leading-tight">{budgetData.budgetCount} bajeti</p>
                <p className="text-[9px] sm:text-[10px] lg:text-xs text-muted-foreground mt-0.5 font-medium leading-snug break-words">TSh {formatCurrency(budgetData.totalBudget)}</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 sm:gap-4">
        {
          (() => {
            const items: [string, number][] = [
              ['Salio la Sasa', continuityData.currentBalance],
              ['Salio la Mwanzo', continuityData.openingBalance],
              ['Salio la Mwisho', continuityData.closingBalance],
              ['Salio la Kuhamisha', continuityData.carryForward],
            ];

            if (currentOrg?.type && currentOrg.type !== 'tawi') {
              items.push(['Jumla ya Muunganiko', continuityData.regionalTotal]);
            }

            if (currentOrg?.type === 'markaz') {
              items.push(['Jumla ya Kitaifa', continuityData.nationalTotal]);
            }

            return items.map(([label, value]) => (
              <Card key={label as string} className="border-l-4 border-l-emerald-500 hover:shadow-md transition-all duration-200">
                <CardHeader className="p-3 pb-1">
                  <CardTitle className="text-[11px] sm:text-xs font-medium text-emerald-700">{label as string}</CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  {loading ? (
                    <div className="h-6 w-20 bg-muted animate-pulse rounded" />
                  ) : (
                    <p className={`text-sm sm:text-lg font-bold ${(value as number) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                      {formatCurrency(value as number)}
                    </p>
                  )}
                </CardContent>
              </Card>
            ));
          })()
        }
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Monthly Bar Chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg text-emerald-700">Mapato vs Matumizi kwa Mwezi</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            {loading ? (
              <div className="h-48 sm:h-72 w-full bg-muted animate-pulse rounded" />
            ) : (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <div className="min-w-[400px]">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={monthlyData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-45} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value)}
                        contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar dataKey="Mapato" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Matumizi" fill="#f97316" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Department Pie Chart */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg text-emerald-700">Mgawanyo wa Idara</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            {loading ? (
              <div className="h-48 sm:h-72 w-full bg-muted animate-pulse rounded" />
            ) : deptData.length === 0 ? (
              <div className="flex items-center justify-center h-48 sm:h-72 text-muted-foreground text-sm">
                Hakuna data ya idara
              </div>
            ) : (
              <div className="overflow-x-auto">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={deptData}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    >
                      {deptData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={DEPARTMENT_COLORS[index % DEPARTMENT_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Transactions */}
        <Card className="lg:col-span-2">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg text-emerald-700">Shughuli za Hivi Karibuni</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 w-full bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : recentTransactions.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground">
                Hakuna shughuli bado
              </div>
            ) : (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-sm min-w-[480px]">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 font-medium">Tarehe</th>
                      <th className="pb-2 font-medium">Aina</th>
                      <th className="pb-2 font-medium">Idara</th>
                      <th className="pb-2 font-medium text-right">Kiasi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTransactions.map(txn => (
                      <tr key={txn.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="py-2 whitespace-nowrap">{new Date(txn.date).toLocaleDateString('sw-TZ')}</td>
                        <td className="py-2">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            txn.type === 'income'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-orange-100 text-orange-700'
                          }`}>
                            {txn.type === 'income' ? 'Mapato' : 'Matumizi'}
                          </span>
                        </td>
                        <td className="py-2 whitespace-nowrap">{txn.department}</td>
                        <td className={`py-2 text-right font-medium whitespace-nowrap ${
                          txn.type === 'income' ? 'text-green-600' : 'text-orange-600'
                        }`}>
                          {txn.type === 'income' ? '+' : '-'}{formatCurrency(txn.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg text-emerald-700">Vitendo vya Haraka</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Anza shughuli haraka</p>
          </CardHeader>
          <CardContent className="space-y-2.5 p-4 pt-0 sm:p-6 sm:pt-0">
            <Button
              className="w-full justify-start bg-green-600 hover:bg-green-700 text-white min-h-[44px] shadow-sm hover:shadow transition-all"
              onClick={() => setActiveSection('income')}
            >
              <PlusCircle className="size-5 mr-2" />
              Ingiza Mapato
            </Button>
            <Button
              className="w-full justify-start bg-orange-600 hover:bg-orange-700 text-white min-h-[44px] shadow-sm hover:shadow transition-all"
              onClick={() => setActiveSection('expense')}
            >
              <MinusCircle className="size-5 mr-2" />
              Ingiza Matumizi
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start border-cyan-300 text-cyan-700 hover:bg-cyan-50 min-h-[44px] shadow-sm hover:shadow transition-all"
              onClick={() => setActiveSection('budget')}
            >
              <Calculator className="size-5 mr-2" />
              Unda Bajeti
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start border-emerald-300 text-emerald-700 hover:bg-emerald-50 min-h-[44px] shadow-sm hover:shadow transition-all"
              onClick={() => setActiveSection('reports')}
            >
              <FileText className="size-5 mr-2" />
              Toa Ripoti
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
