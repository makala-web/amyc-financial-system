'use client';

import { useState, useEffect, useCallback } from 'react';
import type { OrgUnit, OrgLevel, ReportType } from '@/lib/types';
import { useAuthStore, useFinancialStore } from '@/lib/store';
import { getAllActiveOrgUnits } from '@/lib/db-offline';
import { TRANSACTIONS_CHANGED_EVENT } from '@/lib/transaction-sync';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FileText,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Building2,
  Download,
  CalendarDays,
  Layers,
  Landmark,
  Link2,
} from 'lucide-react';

import AnnualSummaryReport from './AnnualSummaryReport';
import MonthlyIncomeReport from './MonthlyIncomeReport';
import MonthlyExpenseReport from './MonthlyExpenseReport';
import DepartmentalReport from './DepartmentalReport';
import ConsolidationReport from './ConsolidationReport';
import ConsolidatedMasterReport from './ConsolidatedMasterReport';
import BranchUnifiedReport from './BranchUnifiedReport';
import RegionalUnifiedReport from './RegionalUnifiedReport';
import MarkazUnifiedReport from './MarkazUnifiedReport';

// ── Month names ──────────────────────────────────────────
const MONTH_NAMES = [
  'Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni',
  'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba',
];

// ── Report type definitions ─────────────────────────────
interface ReportDef {
  id: ReportType;
  label: string;
  description: string;
  levels: OrgLevel[];
  icon: React.ReactNode;
  section?: 'markaz_pekee' | 'muunganiko' | 'jimbo_pekee' | 'jimbo_muunganiko';
}

const REPORT_TYPES: ReportDef[] = [
  // ── Tawi basic reports ─────────────────────────────────
  {
    id: 'annual_summary',
    label: 'Mapato na Matumizi',
    description: 'Taarifa ya Mapato na Matumizi kwa Mwaka',
    levels: ['tawi'],
    icon: <FileText className="h-5 w-5" />,
  },
  {
    id: 'monthly_income',
    label: 'Mapato kwa Mwezi',
    description: 'Fomu ya Mapato kwa Mwezi',
    levels: ['tawi'],
    icon: <TrendingUp className="h-5 w-5" />,
  },
  {
    id: 'monthly_expense',
    label: 'Matumizi kwa Mwezi',
    description: 'Fomu ya Matumizi kwa Mwezi',
    levels: ['tawi'],
    icon: <TrendingDown className="h-5 w-5" />,
  },
  {
    id: 'departmental_annual',
    label: 'Ki-Idara kwa Mwaka',
    description: 'Mapato na Matumizi Ki-Idara kwa Mwaka',
    levels: ['tawi'],
    icon: <Layers className="h-5 w-5" />,
  },
  {
    id: 'branch_unified',
    label: 'Taarifa Jumuishi ya Tawi',
    description: 'Ripoti inayounganisha mapato, matumizi, kategoria, idara na salio',
    levels: ['tawi'],
    icon: <FileText className="h-5 w-5" />,
  },

  // ── Jimbo PEKEE reports (Jimbo's own data) ────────────
  {
    id: 'annual_summary',
    label: 'Mapato na Matumizi',
    description: 'Taarifa ya Mapato na Matumizi ya Jimbo',
    levels: ['jimbo'],
    section: 'jimbo_pekee',
    icon: <FileText className="h-5 w-5" />,
  },
  {
    id: 'monthly_income',
    label: 'Mapato ya Jimbo',
    description: 'Mapato ya Jimbo pekee',
    levels: ['jimbo'],
    section: 'jimbo_pekee',
    icon: <TrendingUp className="h-5 w-5" />,
  },
  {
    id: 'monthly_expense',
    label: 'Matumizi ya Jimbo',
    description: 'Matumizi ya Jimbo pekee',
    levels: ['jimbo'],
    section: 'jimbo_pekee',
    icon: <TrendingDown className="h-5 w-5" />,
  },
  {
    id: 'departmental_annual',
    label: 'Ki-Idara cha Jimbo',
    description: 'Mapato na Matumizi Ki-Idara ya Jimbo pekee',
    levels: ['jimbo'],
    section: 'jimbo_pekee',
    icon: <Layers className="h-5 w-5" />,
  },

  // ── Jimbo MUUNGANIKO reports (Jimbo + Matawi) ─────────
  {
    id: 'consolidation_income',
    label: 'Mapato ya Muunganiko',
    description: 'Muunganiko wa Mapato (Jimbo + Matawi)',
    levels: ['jimbo'],
    section: 'jimbo_muunganiko',
    icon: <TrendingUp className="h-5 w-5" />,
  },
  {
    id: 'consolidation_expense',
    label: 'Matumizi ya Muunganiko',
    description: 'Muunganiko wa Matumizi (Jimbo + Matawi)',
    levels: ['jimbo'],
    section: 'jimbo_muunganiko',
    icon: <TrendingDown className="h-5 w-5" />,
  },
  {
    id: 'consolidation_departmental',
    label: 'Ki-Idara cha Muunganiko',
    description: 'Mapato na Matumizi Ki-Idara (Jimbo + Matawi)',
    levels: ['jimbo'],
    section: 'jimbo_muunganiko',
    icon: <Layers className="h-5 w-5" />,
  },
  {
    id: 'consolidation_full',
    label: 'Mapato na Matumizi ya Muunganiko',
    description: 'Taarifa Kamili ya Muunganiko (Jimbo + Matawi)',
    levels: ['jimbo'],
    section: 'jimbo_muunganiko',
    icon: <BarChart3 className="h-5 w-5" />,
  },
  {
    id: 'consolidation_master',
    label: 'Taarifa Jumuishi ya Jimbo',
    description: 'Muhtasari wa muunganiko: mapato, matumizi, salio, idara na kategoria',
    levels: ['jimbo'],
    section: 'jimbo_muunganiko',
    icon: <FileText className="h-5 w-5" />,
  },
  {
    id: 'markaz_income',
    label: 'Mapato ya Markaz',
    description: 'Mapato ya Markaz pekee',
    levels: ['markaz'],
    section: 'markaz_pekee',
    icon: <TrendingUp className="h-5 w-5" />,
  },
  {
    id: 'markaz_expense',
    label: 'Matumizi ya Markaz',
    description: 'Matumizi ya Markaz pekee',
    levels: ['markaz'],
    section: 'markaz_pekee',
    icon: <TrendingDown className="h-5 w-5" />,
  },
  {
    id: 'markaz_departmental',
    label: 'Ki-Idara cha Markaz',
    description: 'Mapato na Matumizi Ki-Idara cha Markaz pekee',
    levels: ['markaz'],
    section: 'markaz_pekee',
    icon: <Layers className="h-5 w-5" />,
  },
  {
    id: 'markaz_annual_summary',
    label: 'Mapato na Matumizi ya Markaz',
    description: 'Taarifa ya Mapato na Matumizi ya Markaz pekee',
    levels: ['markaz'],
    section: 'markaz_pekee',
    icon: <FileText className="h-5 w-5" />,
  },

  // ── Markaz MUUNGANIKO reports (Markaz + Majimbo) ────
  {
    id: 'consolidation_income',
    label: 'Mapato ya Muunganiko',
    description: 'Muunganiko wa Mapato (Markaz + Majimbo)',
    levels: ['markaz'],
    section: 'muunganiko',
    icon: <TrendingUp className="h-5 w-5" />,
  },
  {
    id: 'consolidation_expense',
    label: 'Matumizi ya Muunganiko',
    description: 'Muunganiko wa Matumizi (Markaz + Majimbo)',
    levels: ['markaz'],
    section: 'muunganiko',
    icon: <TrendingDown className="h-5 w-5" />,
  },
  {
    id: 'consolidation_departmental',
    label: 'Ki-Idara cha Muunganiko',
    description: 'Mapato na Matumizi Ki-Idara (Markaz + Majimbo)',
    levels: ['markaz'],
    section: 'muunganiko',
    icon: <Layers className="h-5 w-5" />,
  },
  {
    id: 'consolidation_full',
    label: 'Mapato na Matumizi ya Muunganiko',
    description: 'Taarifa Kamili ya Muunganiko (Markaz + Majimbo)',
    levels: ['markaz'],
    section: 'muunganiko',
    icon: <BarChart3 className="h-5 w-5" />,
  },
  {
    id: 'consolidation_master',
    label: 'Ripoti Jumuishi ya Kitaifa',
    description: 'Ripoti rasmi ya kitaifa: muunganiko wa Markaz Kuu na Majimbo yote',
    levels: ['markaz'],
    section: 'muunganiko',
    icon: <FileText className="h-5 w-5" />,
  },
];

// ── Child type mapping for consolidation ────────────────
const CHILD_TYPE_MAP: Record<OrgLevel, OrgLevel | null> = {
  markaz: 'jimbo',
  jimbo: 'tawi',
  tawi: null,
};

// ── Component ────────────────────────────────────────────
export default function ReportsEngine() {
  const { currentOrg, currentUser } = useAuthStore();
  const { selectedYear, selectedMonth, setSelectedYear } = useFinancialStore();

  const [selectedReport, setSelectedReport] = useState<ReportType | null>(null);
  // Local report month: 0 = YOTE (all months), 1-12 = specific month
  const [reportMonth, setReportMonth] = useState<number>(selectedMonth);
  const [childOrgUnits, setChildOrgUnits] = useState<OrgUnit[]>([]);
  const [selectedChildIds, setSelectedChildIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const yearOptions = Array.from({ length: 15 }, (_, i) => 2026 + i);

  // Derive monthMode from reportMonth
  const monthMode: 'all' | 'single' = reportMonth === 0 ? 'all' : 'single';
  const month = reportMonth; // 0 = all months, 1-12 = specific month

  // ── Load child org units for consolidation ───────────
  const loadChildOrgUnits = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);
    try {
      const childType = CHILD_TYPE_MAP[currentOrg.type];
      if (childType) {
        const allChildType = await getAllActiveOrgUnits(childType);
        const children = allChildType.filter(
          (c) => c.parentId === currentOrg.id
        );
        setChildOrgUnits(children);
        setSelectedChildIds(new Set(children.map((c) => c.id!)));
      } else {
        setChildOrgUnits([]);
        setSelectedChildIds(new Set());
      }
    } finally {
      setLoading(false);
    }
  }, [currentOrg]);

  useEffect(() => {
    loadChildOrgUnits();
  }, [loadChildOrgUnits]);

  useEffect(() => {
    const onTransactionsChanged = () => setRefreshKey((value) => value + 1);
    window.addEventListener(TRANSACTIONS_CHANGED_EVENT, onTransactionsChanged);
    return () => window.removeEventListener(TRANSACTIONS_CHANGED_EVENT, onTransactionsChanged);
  }, []);

  // ── Get available reports for current level ──────────
  const availableReports = REPORT_TYPES.filter((r) =>
    currentOrg ? r.levels.includes(currentOrg.type) : true
  );

  // ── Split reports into sections for Markaz ───────────
  const isMarkaz = currentOrg?.type === 'markaz';
  const isJimbo = currentOrg?.type === 'jimbo';
  const markazPekeeReports = isMarkaz
    ? availableReports.filter((r) => r.section === 'markaz_pekee')
    : [];
  const markazMuunganikoReports = isMarkaz
    ? availableReports.filter((r) => r.section === 'muunganiko')
    : [];
  const jimboPekeeReports = isJimbo
    ? availableReports.filter((r) => r.section === 'jimbo_pekee')
    : [];
  const jimboMuunganikoReports = isJimbo
    ? availableReports.filter((r) => r.section === 'jimbo_muunganiko')
    : [];

  // ── Check if consolidation type ──────────────────────
  const isConsolidation =
    selectedReport === 'consolidation_income' ||
    selectedReport === 'consolidation_expense' ||
    selectedReport === 'consolidation_full' ||
    selectedReport === 'consolidation_departmental' ||
    selectedReport === 'consolidation_master';

  // ── Toggle child selection ───────────────────────────
  const toggleChild = (id: number) => {
    setSelectedChildIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllChildren = () => {
    if (selectedChildIds.size === childOrgUnits.length) {
      setSelectedChildIds(new Set());
    } else {
      setSelectedChildIds(new Set(childOrgUnits.map((c) => c.id!)));
    }
  };

  // ── Render report type card ──────────────────────────
  const renderReportCard = (report: ReportDef) => {
    const isSelected = selectedReport === report.id;
    return (
      <Card
        key={`${report.id}-${report.section || 'default'}`}
        className={`min-w-0 cursor-pointer transition-all hover:shadow-md ${
          isSelected
            ? 'border-emerald-500 ring-2 ring-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/30'
            : 'hover:border-emerald-300'
        }`}
        onClick={() => setSelectedReport(report.id)}
      >
        <CardContent className="p-4">
          <div className="flex min-w-0 items-start gap-2 mb-1">
            <span className={`shrink-0 ${isSelected ? 'text-emerald-600' : 'text-muted-foreground'}`}>
              {report.icon}
            </span>
            <span className={`min-w-0 font-medium text-sm leading-snug break-words ${isSelected ? 'text-emerald-800' : ''}`}>
              {report.label}
            </span>
          </div>
          <p className="text-xs leading-snug text-muted-foreground break-words">{report.description}</p>
        </CardContent>
      </Card>
    );
  };

  // ── Render report component ──────────────────────────
  const renderReport = () => {
    if (!selectedReport || !currentOrg) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <FileText className="h-16 w-16 mb-4 opacity-30" />
          <p className="text-lg">Chagua aina ya taarifa ili kuianza</p>
        </div>
      );
    }

    const orgUnitId = currentOrg.id!;
    const orgLevel = currentOrg.type;
    const orgName = currentOrg.name;

    switch (selectedReport) {
      case 'annual_summary':
        return (
          <AnnualSummaryReport
            orgUnitId={orgUnitId}
            year={selectedYear}
            orgLevel={orgLevel}
            orgName={orgName}
            monthMode={monthMode}
            month={month}
          />
        );
      case 'monthly_income':
        return (
          <MonthlyIncomeReport
            orgUnitId={orgUnitId}
            month={month}
            year={selectedYear}
            orgName={orgName}
            orgLevel={orgLevel}
            monthMode={monthMode}
          />
        );
      case 'monthly_expense':
        return (
          <MonthlyExpenseReport
            orgUnitId={orgUnitId}
            month={month}
            year={selectedYear}
            orgName={orgName}
            orgLevel={orgLevel}
            monthMode={monthMode}
          />
        );
      case 'departmental_annual':
        return (
          <DepartmentalReport
            orgUnitId={orgUnitId}
            year={selectedYear}
            orgLevel={orgLevel}
            orgName={orgName}
            monthMode={monthMode}
            month={month}
          />
        );

      case 'branch_unified':
        return (
          <BranchUnifiedReport
            orgUnitId={orgUnitId}
            year={selectedYear}
            orgName={orgName}
            monthMode={monthMode}
            month={month}
          />
        );

      case 'regional_unified':
        return (
          <RegionalUnifiedReport
            orgUnitId={orgUnitId}
            year={selectedYear}
            orgName={orgName}
            monthMode={monthMode}
            month={month}
          />
        );

      // ── Markaz PEKEE reports (reuse existing components with Markaz orgUnitId) ──
      case 'markaz_income':
        return (
          <MonthlyIncomeReport
            orgUnitId={orgUnitId}
            month={month}
            year={selectedYear}
            orgName={orgName}
            orgLevel={orgLevel}
            monthMode={monthMode}
          />
        );
      case 'markaz_expense':
        return (
          <MonthlyExpenseReport
            orgUnitId={orgUnitId}
            month={month}
            year={selectedYear}
            orgName={orgName}
            orgLevel={orgLevel}
            monthMode={monthMode}
          />
        );
      case 'markaz_departmental':
        return (
          <DepartmentalReport
            orgUnitId={orgUnitId}
            year={selectedYear}
            orgLevel={orgLevel}
            orgName={orgName}
            monthMode={monthMode}
            month={month}
          />
        );
      case 'markaz_annual_summary':
        return (
          <AnnualSummaryReport
            orgUnitId={orgUnitId}
            year={selectedYear}
            orgLevel={orgLevel}
            orgName={orgName}
            monthMode={monthMode}
            month={month}
          />
        );

      // ── Muunganiko / Consolidation reports ──
      case 'consolidation_income':
        return (
          <ConsolidationReport
            orgUnitId={orgUnitId}
            year={selectedYear}
            orgLevel={orgLevel}
            orgName={orgName}
            subType="income"
            selectedChildIds={selectedChildIds}
            monthMode={monthMode}
            month={month}
          />
        );
      case 'consolidation_expense':
        return (
          <ConsolidationReport
            orgUnitId={orgUnitId}
            year={selectedYear}
            orgLevel={orgLevel}
            orgName={orgName}
            subType="expense"
            selectedChildIds={selectedChildIds}
            monthMode={monthMode}
            month={month}
          />
        );
      case 'consolidation_departmental':
        return (
          <ConsolidationReport
            orgUnitId={orgUnitId}
            year={selectedYear}
            orgLevel={orgLevel}
            orgName={orgName}
            subType="consolidation_departmental"
            selectedChildIds={selectedChildIds}
            monthMode={monthMode}
            month={month}
          />
        );
      case 'consolidation_full':
        return (
          <ConsolidationReport
            orgUnitId={orgUnitId}
            year={selectedYear}
            orgLevel={orgLevel}
            orgName={orgName}
            subType="full"
            selectedChildIds={selectedChildIds}
            monthMode={monthMode}
            month={month}
          />
        );
      case 'consolidation_master':
        if (orgLevel === 'jimbo') {
          return (
            <RegionalUnifiedReport
              orgUnitId={orgUnitId}
              year={selectedYear}
              orgName={orgName}
              monthMode={monthMode}
              month={month}
            />
          );
        }
        if (orgLevel === 'markaz') {
          return (
            <MarkazUnifiedReport
              orgUnitId={orgUnitId}
              year={selectedYear}
              orgName={orgName}
              monthMode={monthMode}
              month={month}
            />
          );
        }
        return (
          <ConsolidatedMasterReport
            orgUnitId={orgUnitId}
            year={selectedYear}
            orgLevel={orgLevel}
            orgName={orgName}
            selectedChildIds={selectedChildIds}
            monthMode={monthMode}
            month={month}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-emerald-600" />
            Taarifa na Ripoti
          </h2>
          <p className="text-muted-foreground mt-1">
            Tazama na kuhamisha taarifa za kifedha
          </p>
        </div>

        {/* Year & Month selectors — visible for ALL report types */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <CalendarDays className="h-4 w-4 text-emerald-600 shrink-0" />
            <Label className="text-sm font-medium whitespace-nowrap">Mwaka:</Label>
            <Select
              value={String(selectedYear)}
              onValueChange={(v) => setSelectedYear(Number(v))}
            >
              <SelectTrigger className="w-full sm:w-28 border-emerald-200 min-h-[44px] sm:min-h-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Month selector — always visible, includes YOTE option */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Label className="text-sm font-medium whitespace-nowrap">Mwezi:</Label>
            <Select
              value={String(reportMonth)}
              onValueChange={(v) => setReportMonth(Number(v))}
            >
              <SelectTrigger className="w-full sm:w-40 border-emerald-200 min-h-[44px] sm:min-h-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">YOTE (Miezi yote)</SelectItem>
                {MONTH_NAMES.map((m, i) => (
                  <SelectItem key={i} value={String(i + 1)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── Report type selection cards ────────────────────── */}
      {isMarkaz ? (
        /* Markaz level: two sections with headers */
        <div className="space-y-6">
          {/* MARKAZ PEKEE Section */}
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Landmark className="h-5 w-5 text-emerald-700" />
              <h3 className="text-base font-bold text-emerald-800">MARKAZ PEKEE</h3>
              <span className="text-xs text-muted-foreground">(Taarifa ya Markaz pekee)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {markazPekeeReports.map(renderReportCard)}
            </div>
          </div>

          <Separator className="bg-emerald-200" />

          {/* MUUNGANIKO Section */}
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Link2 className="h-5 w-5 text-emerald-700" />
              <h3 className="text-base font-bold text-emerald-800">MUUNGANIKO</h3>
              <span className="text-xs text-muted-foreground">(Markaz + Majimbo)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {markazMuunganikoReports.map(renderReportCard)}
            </div>
          </div>
        </div>
      ) : isJimbo ? (
        /* Jimbo level: two sections with headers */
        <div className="space-y-6">
          {/* JIMBO PEKEE Section */}
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Landmark className="h-5 w-5 text-emerald-700" />
              <h3 className="text-base font-bold text-emerald-800">JIMBO PEKEE</h3>
              <span className="text-xs text-muted-foreground">(Taarifa ya Jimbo pekee)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {jimboPekeeReports.map(renderReportCard)}
            </div>
          </div>

          <Separator className="bg-emerald-200" />

          {/* MUUNGANIKO Section */}
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Link2 className="h-5 w-5 text-emerald-700" />
              <h3 className="text-base font-bold text-emerald-800">MUUNGANIKO</h3>
              <span className="text-xs text-muted-foreground">(Jimbo + Matawi)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {jimboMuunganikoReports.map(renderReportCard)}
            </div>
          </div>
        </div>
      ) : (
        /* Tawi: flat grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {availableReports.map(renderReportCard)}
        </div>
      )}

      {/* Consolidation child selector */}
      {isConsolidation && childOrgUnits.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-emerald-800">
              Chagua Vitengo vidogo
            </CardTitle>
            <CardDescription>
              {isMarkaz
                ? 'Chagua ni Majimbo gani utakavyo kuwa katika muunganiko (pamoja na Markaz yenyewe)'
                : 'Chagua ni vitengo gani vidogo utakavyo kuwa katika muunganiko'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mb-3">
              <Checkbox
                id="select-all-children"
                checked={selectedChildIds.size === childOrgUnits.length}
                onCheckedChange={toggleAllChildren}
                className="border-emerald-400 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
              />
              <Label htmlFor="select-all-children" className="text-sm font-medium">
                Chagua vyote ({childOrgUnits.length})
              </Label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {childOrgUnits.map((child) => (
                <div
                  key={child.id}
                  className="flex items-center gap-2 p-2 rounded-md border border-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors min-h-[44px]"
                >
                  <Checkbox
                    id={`child-${child.id}`}
                    checked={selectedChildIds.has(child.id!)}
                    onCheckedChange={() => toggleChild(child.id!)}
                    className="border-emerald-400 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                  />
                  <Label
                    htmlFor={`child-${child.id}`}
                    className="text-sm cursor-pointer"
                  >
                    {child.name}
                  </Label>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* No child orgs message for consolidation */}
      {isConsolidation && childOrgUnits.length === 0 && !loading && (
        <Card>
          <CardContent className="p-4">
            <div className="text-center py-6 text-muted-foreground">
              <Building2 className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Hakuna vitengo vidogo vilivyosajiliwa chini ya {currentOrg?.name || 'kitengo hiki'}</p>
              <p className="text-xs mt-1">
                {currentOrg?.type === 'markaz'
                  ? 'Sajili Majimbo chini ya Markaz hii ili kuweza kuunda muunganiko'
                  : currentOrg?.type === 'jimbo'
                  ? 'Sajili Matawi chini ya Jimbo hili ili kuweza kuunda muunganiko'
                  : ''}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Report output */}
      <Card className="overflow-hidden">
        <CardContent
          key={`${selectedReport || 'empty'}-${selectedYear}-${reportMonth}-${refreshKey}`}
          className="p-3 sm:p-4 overflow-x-auto"
        >
          {renderReport()}
        </CardContent>
      </Card>
    </div>
  );
}
