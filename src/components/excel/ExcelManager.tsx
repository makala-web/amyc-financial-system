'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuthStore } from '@/lib/store';
import { db, getAllActiveOrgUnits, getChildOrgUnits } from '@/lib/db-offline';
import type { OrgUnit } from '@/lib/types';
import { MONTHS, DEPARTMENTS } from '@/lib/types';
import {
  exportIncomeExcel,
  exportExpenseExcel,
  exportAnnualSummaryExcel,
  exportDepartmentalExcel,
  exportConsolidationExcel,
  exportReportNineExcel,
  exportZoteExcel,
  exportRipotiKamiliExcel,
} from './ExcelExport';
import ExcelImport from './ExcelImport';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Download,
  Upload,
  FileSpreadsheet,
  Loader2,
  BarChart3,
  PieChart,
  Building2,
  Star,
  Layers,
  CalendarDays,
  FileCheck,
  Users,
} from 'lucide-react';

// ============================================================
// Export type definitions with metadata
// ============================================================

interface ExportOption {
  value: string;
  label: string;
  swahiliLabel: string;
  description: string;
  icon: React.ReactNode;
  recommended?: boolean;
  sheets: string[];
}

const EXPORT_OPTIONS: ExportOption[] = [
  {
    value: 'ripoti_kamili',
    label: 'Full Report',
    swahiliLabel: 'Ripoti Kamili (Zote)',
    description: 'Faili moja lenye karatasi zote: Mapato, Matumizi, Ki-Idara, Taarifa ya Mwaka, na Muunganiko (kama ipo)',
    icon: <Star className="h-3.5 w-3.5 text-amber-500" />,
    recommended: true,
    sheets: ['Mapato', 'Matumizi', 'Ki-Idara', 'Taarifa ya Mwaka', 'Muunganiko*'],
  },
  {
    value: 'mapato',
    label: 'Income',
    swahiliLabel: 'Mapato',
    description: 'Ripoti ya mapato ya mwezi au mwaka pekee',
    icon: <PieChart className="h-3.5 w-3.5 text-emerald-600" />,
    sheets: ['Mapato'],
  },
  {
    value: 'matumizi',
    label: 'Expenses',
    swahiliLabel: 'Matumizi',
    description: 'Ripoti ya matumizi ya mwezi au mwaka pekee',
    icon: <PieChart className="h-3.5 w-3.5 text-red-500" />,
    sheets: ['Matumizi'],
  },
  {
    value: 'taarifa_mwaka',
    label: 'Muhtasari wa Mwaka',
    swahiliLabel: 'Taarifa ya Mwaka',
    description: 'Muhtasari wa mapato na matumizi kwa mwaka (ki-mwezi)',
    icon: <BarChart3 className="h-3.5 w-3.5 text-amber-600" />,
    sheets: ['Taarifa ya Mwaka'],
  },
  {
    value: 'ki_idara',
    label: 'Departmental',
    swahiliLabel: 'Ki-Idara',
    description: 'Mapato na matumizi kulingana na idara',
    icon: <Building2 className="h-3.5 w-3.5 text-emerald-600" />,
    sheets: ['Ki-Idara'],
  },
  {
    value: 'muunganiko',
    label: 'Consolidation',
    swahiliLabel: 'Muunganiko',
    description: 'Muunganiko wa vitengo vya chini (Jimbo/Markaz pekee)',
    icon: <Users className="h-3.5 w-3.5 text-emerald-600" />,
    sheets: ['Muunganiko'],
  },
  {
    value: 'ripoti_tisa',
    label: 'Report Nine',
    swahiliLabel: 'Ripoti ya Tisa',
    description: 'Snapshot rasmi ya Jimbo/Markaz yenye metadata maalum kwa kupakiwa Markaz Kuu',
    icon: <FileCheck className="h-3.5 w-3.5 text-amber-600" />,
    recommended: true,
    sheets: ['Metadata', 'Muhtasari', 'Ki-Idara', 'Kategoria'],
  },
];

// ============================================================
// ExcelManager - Main Excel Import/Export UI
// ============================================================

export default function ExcelManager() {
  const { currentOrg } = useAuthStore();

  // Export state
  const [reportType, setReportType] = useState<string>('ripoti_kamili');
  const [selectedYear, setSelectedYear] = useState<string>(String(Math.max(2026, Math.min(new Date().getFullYear(), 2040))));
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [childOrgs, setChildOrgs] = useState<OrgUnit[]>([]);

  // Generate year options (2026 to 2040)
  const yearOptions = Array.from({ length: 15 }, (_, i) => 2026 + i);

  // Load org units
  useEffect(() => {
    async function loadOrgs() {
      const orgs = await getAllActiveOrgUnits();
      setOrgUnits(orgs);
    }
    loadOrgs();
  }, []);

  // Load child orgs when currentOrg changes
  useEffect(() => {
    async function loadChildren() {
      if (currentOrg?.id) {
        const children = await getChildOrgUnits(currentOrg.id);
        setChildOrgs(children);
      }
    }
    loadChildren();
  }, [currentOrg]);

  // Get the org unit for export
  const getExportOrg = (): OrgUnit => {
    return currentOrg || {
      id: 1,
      name: 'AMYC',
      type: 'markaz',
      parentId: null,
      code: 'MK',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  // Check if consolidation is available
  const canConsolidate = currentOrg && (currentOrg.type === 'jimbo' || currentOrg.type === 'markaz') && childOrgs.length > 0;

  // Get the currently selected export option
  const selectedOption = EXPORT_OPTIONS.find(o => o.value === reportType);

  // Handle export
  const handleExport = async () => {
    if (!reportType) return;

    setIsExporting(true);
    const org = getExportOrg();
    const year = parseInt(selectedYear);
    const month = selectedMonth && selectedMonth !== '0' ? parseInt(selectedMonth) : undefined;

    try {
      switch (reportType) {
        case 'ripoti_kamili':
          await exportRipotiKamiliExcel(org, year, month, childOrgs);
          break;
        case 'mapato':
          await exportIncomeExcel(org, year, month);
          break;
        case 'matumizi':
          await exportExpenseExcel(org, year, month);
          break;
        case 'zote':
          await exportZoteExcel(org, year, month);
          break;
        case 'taarifa_mwaka':
          await exportAnnualSummaryExcel(org, year, month);
          break;
        case 'ki_idara':
          await exportDepartmentalExcel(org, year, month);
          break;
        case 'muunganiko':
          await exportConsolidationExcel(org, year, childOrgs, month);
          break;
        case 'ripoti_tisa':
          await exportReportNineExcel(org, year, month, childOrgs);
          break;
      }
    } catch (error) {
      console.error('Export error:', error);
    }

    setIsExporting(false);
  };

  // Compute org units for import based on org level
  // Jimbo imports into child Matawi. Markaz imports into child Majimbo.
  // Tawi imports into itself only to avoid selecting unrelated org units.
  const importOrgUnits = useMemo(() => {
    if (!currentOrg) return [];
    if (currentOrg.type === 'jimbo' || currentOrg.type === 'markaz') {
      return childOrgs;
    }
    if (currentOrg.type === 'tawi') {
      return [currentOrg];
    }
    return [];
  }, [currentOrg, childOrgs]);

  // Dynamic description for import tab based on org level
  const importDescription = useMemo(() => {
    if (currentOrg?.type === 'jimbo') {
      return 'Pakia ripoti za Tawi kupitia Excel. Chagua Tawi kwanza, kisha pakia faili.';
    }
    if (currentOrg?.type === 'markaz') {
      return 'Pakia ripoti za Jimbo kupitia Excel. Chagua Jimbo kwanza, kisha pakia faili.';
    }
    return 'Pakia data ya kifedha kutoka faili ya Excel kwa Tawi, Jimbo au Markaz kulingana na kiwango chako.';
  }, [currentOrg]);

  // Dynamic description for export tab based on org level
  const exportDescription = useMemo(() => {
    if (currentOrg?.type === 'jimbo') {
      return 'Pakua ripoti ya kifedha kama faili ya Excel — hiji ni data ya Jimbo pamoja na muunganiko wa Matawi';
    }
    if (currentOrg?.type === 'markaz') {
      return 'Pakua ripoti ya kifedha kama faili ya Excel — hiji ni data ya Markaz Kuu pamoja na muunganiko wa Majimbo';
    }
    return 'Pakua ripoti ya kifedha kama faili ya Excel';
  }, [currentOrg]);

  return (
    <div className="space-y-6">
      <Tabs defaultValue="export" className="w-full">
        <TabsList className="w-full grid grid-cols-2 bg-emerald-50 dark:bg-emerald-950/30">
          <TabsTrigger
            value="export"
            className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
          >
            <Download className="h-4 w-4 mr-2" />
            Pakua Excel
          </TabsTrigger>
          <TabsTrigger
            value="import"
            className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
          >
            <Upload className="h-4 w-4 mr-2" />
            Pakia Excel
          </TabsTrigger>
        </TabsList>

        {/* ============================================ */}
        {/* EXPORT TAB */}
        {/* ============================================ */}
        <TabsContent value="export">
          <Card className="border-emerald-200 dark:border-emerald-900">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <FileSpreadsheet className="h-5 w-5" />
                Pakua Excel
              </CardTitle>
              <CardDescription>
                {exportDescription}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Report Type Selection */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Aina ya Ripoti</Label>
                <Select value={reportType} onValueChange={setReportType}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Chagua aina ya ripoti..." />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPORT_OPTIONS.map((option) => {
                      // Hide muunganiko if not applicable
                      if (option.value === 'muunganiko' && !canConsolidate) return null;
                      if (option.value === 'ripoti_tisa' && !(currentOrg?.type === 'jimbo' || currentOrg?.type === 'markaz')) return null;
                      return (
                        <SelectItem key={option.value} value={option.value}>
                          <span className="flex items-center gap-2">
                            {option.icon}
                            {option.swahiliLabel}
                            {option.recommended && (
                              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-400 dark:border-amber-800">
                                INAPENDEKEZWA
                              </Badge>
                            )}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Selected Export Option Description */}
              {selectedOption && (
                <div className={`rounded-lg p-3 border ${
                  selectedOption.recommended
                    ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800'
                    : 'bg-muted/50 border-muted'
                }`}>
                  <div className="flex items-start gap-2">
                    {selectedOption.recommended ? (
                      <Star className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
                    ) : (
                      <FileSpreadsheet className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2">
                        {selectedOption.swahiliLabel}
                        {selectedOption.recommended && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-400 dark:border-amber-800">
                            INAPENDEKEZWA
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{selectedOption.description}</p>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {selectedOption.sheets.map((sheet) => (
                          <Badge key={sheet} variant="outline" className="text-[10px] px-1.5 py-0">
                            <Layers className="h-2.5 w-2.5 mr-1" />
                            {sheet}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Year Selection */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Mwaka</Label>
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Chagua mwaka..." />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((yr) => (
                      <SelectItem key={yr} value={String(yr)}>
                        {yr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Month Selection (available for ALL export types) */}
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Mwezi <span className="text-muted-foreground font-normal">(si lazima - kwa mwezi fulani)</span>
                </Label>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Mwezi wote (Mwaka mzima)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Mwezi wote (Mwaka mzima)</SelectItem>
                    {MONTHS.map((month, idx) => (
                      <SelectItem key={idx} value={String(idx + 1)}>
                        {month}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Current Org Info */}
              {currentOrg && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 p-4 border border-emerald-200 dark:border-emerald-800">
                  <div className="text-sm">
                    <span className="font-medium text-emerald-700 dark:text-emerald-400">Kitengo: </span>
                    <span>{currentOrg.name}</span>
                    <span className="text-muted-foreground ml-2">
                      ({currentOrg.type === 'tawi' ? 'Tawi' : currentOrg.type === 'jimbo' ? 'Jimbo' : 'Markaz'})
                    </span>
                  </div>
                  {canConsolidate && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Vitengo vya chini: {childOrgs.length}
                    </div>
                  )}
                </div>
              )}

              {/* Workflow Info Banner */}
              {reportType === 'ripoti_kamili' && currentOrg?.type === 'tawi' && (
                <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 p-3 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-start gap-2">
                    <FileCheck className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
                    <div className="text-xs text-blue-700 dark:text-blue-400">
                      <span className="font-medium">Mfumo wa Uhamisho:</span> Tawi linapakua faili moja → linapeleka WhatsApp kwa Jimbo → Jimbo linapakia na data yote inakamatwa
                    </div>
                  </div>
                </div>
              )}

              <Separator />

              {/* Export Button */}
              <Button
                onClick={handleExport}
                disabled={!reportType || isExporting}
                className={`w-full h-11 text-white ${
                  selectedOption?.recommended
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Inaandaa Excel...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    {selectedOption?.recommended
                      ? 'Pakua Ripoti Kamili'
                      : 'Pakua Excel'}
                  </>
                )}
              </Button>

              {/* Export Options Reference */}
              <div className="space-y-1.5 mt-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">Aina za Ripoti:</p>
                {EXPORT_OPTIONS.map((option) => {
                  if (option.value === 'muunganiko' && !canConsolidate) return null;
                  if (option.value === 'ripoti_tisa' && !(currentOrg?.type === 'jimbo' || currentOrg?.type === 'markaz')) return null;
                  return (
                    <div
                      key={option.value}
                      className={`flex items-start gap-2.5 text-xs p-2 rounded-md cursor-pointer transition-colors ${
                        reportType === option.value
                          ? option.recommended
                            ? 'bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-800'
                            : 'bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800'
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setReportType(option.value)}
                    >
                      {option.recommended ? (
                        <Star className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
                      ) : (
                        <FileSpreadsheet className={`h-4 w-4 mt-0.5 shrink-0 ${
                          option.value === 'matumizi' ? 'text-red-500' :
                          option.value === 'taarifa_mwaka' ? 'text-amber-600' :
                          'text-emerald-500'
                        }`} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground">{option.swahiliLabel}</span>
                          {option.recommended && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-400 dark:border-amber-800">
                              INAPENDEKEZWA
                            </Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground mt-0.5">{option.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================ */}
        {/* IMPORT TAB */}
        {/* ============================================ */}
        <TabsContent value="import">
          {/* Info banner for Jimbo/Markaz workflow */}
          {currentOrg?.type === 'jimbo' && (
            <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm">
              <p className="font-semibold text-amber-800">📋 Mfumo wa Kupakia</p>
              <p className="text-amber-700 mt-1">Chagua Tawi → Pakia Excel ya Ripoti ya Tawi → Data itaunganishwa na Ripoti ya Jimbo</p>
            </div>
          )}
          {currentOrg?.type === 'markaz' && (
            <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm">
              <p className="font-semibold text-amber-800">📋 Mfumo wa Kupakia</p>
              <p className="text-amber-700 mt-1">Chagua Jimbo → Pakia Excel ya Ripoti ya Jimbo → Data itaunganishwa na Ripoti ya Markaz Kuu</p>
            </div>
          )}
          <ExcelImport orgUnits={importOrgUnits} currentOrg={currentOrg} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
