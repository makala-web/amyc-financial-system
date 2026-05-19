'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/lib/store';
import { db } from '@/lib/db-offline';
import {
  downloadReportPDF,
  openReportPrintPreview,
  buildPrintTable,
  formatPrintNum,
} from '@/lib/print-report';
import type {
  PerformanceReport,
  DepartmentReportData,
  LeaderInfo,
  GoalItem,
  StrategicPriority,
  OrgLevel,
} from '@/lib/types';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Trash2,
  Edit,
  FileText,
  Printer,
  RefreshCw,
  ClipboardList,
  ArrowLeft,
  Save,
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────
const ORG_LEVEL_LABELS: Record<OrgLevel, string> = {
  tawi: 'Tawi',
  jimbo: 'Jimbo',
  markaz: 'Markaz Kuu',
};

const LEADER_POSITIONS = [
  'Mudir',
  'Naibu Mudir',
  'Katibu',
  'Mweka Hazina',
  "Mkuu wa Da'awah",
  'Mkuu wa Elimu',
  'Mkuu wa Ustawi wa Jamii',
  'Mkuu wa Uchumi',
  'Mkuu wa Habari na Uenezi',
];

const DEPT_KEYS = ['daawah', 'elimu', 'ustawi', 'uchumi', 'habari'] as const;

const DEPT_LABELS: Record<string, string> = {
  daawah: "Da'awah",
  elimu: 'Elimu',
  ustawi: 'Ustawi wa Jamii',
  uchumi: 'Uchumi & Miradi',
  habari: 'Habari na Uenezi',
};

// ── Helper: Empty department data ────────────────────────────
function emptyDeptData(): DepartmentReportData {
  return {
    activities: [],
    achievements: [],
    challenges: [],
    recommendations: [],
  };
}

function emptyReport(
  currentUser: {
    id?: number;
    fullName: string;
    role: string;
    email: string;
    orgLevel: OrgLevel;
    orgUnitId: number;
  } | null,
  currentOrg: { name: string; type: OrgLevel } | null,
): PerformanceReport {
  return {
    orgUnitId: currentUser?.orgUnitId ?? 0,
    orgLevel: currentUser?.orgLevel ?? 'tawi',
    period: '',
    title: '',
    dateCreated: new Date().toISOString(),
    dateUpdated: new Date().toISOString(),
    createdBy: currentUser?.id ?? 0,
    authorName: currentUser?.fullName ?? '',
    authorRole: currentUser?.role ?? '',
    authorPhone: '',
    authorEmail: currentUser?.email ?? '',
    region: '',
    district: '',
    ward: '',
    street: '',
    leaders: LEADER_POSITIONS.map((pos) => ({ position: pos, name: '', phone: '' })),
    introduction: '',
    daawah: emptyDeptData(),
    elimu: emptyDeptData(),
    ustawi: emptyDeptData(),
    uchumi: { ...emptyDeptData(), projects: [], income: 0, expense: 0, balance: 0 },
    habari: {
      ...emptyDeptData(),
      whatsappGroups: '',
      digitalSystem: '',
      website: '',
      socialMedia: '',
      systemNeeds: '',
    },
    goals: [],
    strategicPriorities: [],
    conclusion: '',
    mudirName: '',
    mudirSignature: '',
    katibuName: '',
    katibuSignature: '',
    signatureDate: new Date().toISOString().split('T')[0],
  };
}

// ── Component ────────────────────────────────────────────────
export default function PerformanceReportPage() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const currentOrg = useAuthStore((s) => s.currentOrg);

  const [reports, setReports] = useState<PerformanceReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<PerformanceReport>(emptyReport(currentUser, currentOrg));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Load reports
  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const orgId = currentUser?.orgUnitId ?? 0;
      const all = await db.performanceReports
        .where('orgUnitId')
        .equals(orgId)
        .toArray();
      setReports(
        all.sort(
          (a, b) =>
            new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [currentUser?.orgUnitId]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  // ── Form helpers ──────────────────────────────────────────
  const updateField = <K extends keyof PerformanceReport>(
    key: K,
    value: PerformanceReport[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateLeader = (index: number, field: keyof LeaderInfo, value: string) => {
    setForm((prev) => {
      const leaders = [...prev.leaders];
      leaders[index] = { ...leaders[index], [field]: value };
      return { ...prev, leaders };
    });
  };

  const updateDept = <K extends keyof DepartmentReportData>(
    deptKey: string,
    key: K,
    value: DepartmentReportData[K],
  ) => {
    setForm((prev) => ({
      ...prev,
      [deptKey]: {
        ...(prev[deptKey as keyof PerformanceReport] as DepartmentReportData),
        [key]: value,
      },
    }));
  };

  const addDeptItem = (
    deptKey: string,
    itemType: 'activities' | 'achievements' | 'challenges' | 'recommendations' | 'projects',
  ) => {
    setForm((prev) => {
      const dept = prev[deptKey as keyof PerformanceReport] as DepartmentReportData;
      const list = [...(dept[itemType] as unknown as any[])];
      if (itemType === 'activities')
        list.push({ activity: '', area: '', date: '', participants: 0, notes: '' });
      else if (itemType === 'achievements')
        list.push({ achievement: '', description: '' });
      else if (itemType === 'challenges') list.push({ challenge: '', impact: '' });
      else if (itemType === 'recommendations')
        list.push({ recommendation: '', action: '' });
      else if (itemType === 'projects')
        list.push({ name: '', progress: '', funding: '', status: '' });
      return { ...prev, [deptKey]: { ...dept, [itemType]: list } };
    });
  };

  const removeDeptItem = (deptKey: string, itemType: string, index: number) => {
    setForm((prev) => {
      const dept = prev[deptKey as keyof PerformanceReport] as DepartmentReportData;
      const list = [
        ...(dept[itemType as keyof DepartmentReportData] as unknown as any[]),
      ];
      list.splice(index, 1);
      return { ...prev, [deptKey]: { ...dept, [itemType]: list } };
    });
  };

  const updateDeptItem = (
    deptKey: string,
    itemType: string,
    index: number,
    field: string,
    value: string | number,
  ) => {
    setForm((prev) => {
      const dept = prev[deptKey as keyof PerformanceReport] as DepartmentReportData;
      const list = [
        ...(dept[itemType as keyof DepartmentReportData] as unknown as any[]),
      ];
      list[index] = { ...list[index], [field]: value };
      return { ...prev, [deptKey]: { ...dept, [itemType]: list } };
    });
  };

  const addGoal = () => {
    setForm((prev) => ({
      ...prev,
      goals: [...prev.goals, { goal: '', timeline: '', responsible: '' }],
    }));
  };

  const removeGoal = (index: number) => {
    setForm((prev) => {
      const goals = [...prev.goals];
      goals.splice(index, 1);
      return { ...prev, goals };
    });
  };

  const updateGoal = (index: number, field: keyof GoalItem, value: string) => {
    setForm((prev) => {
      const goals = [...prev.goals];
      goals[index] = { ...goals[index], [field]: value };
      return { ...prev, goals };
    });
  };

  const addPriority = () => {
    setForm((prev) => ({
      ...prev,
      strategicPriorities: [
        ...prev.strategicPriorities,
        { priority: '', description: '' },
      ],
    }));
  };

  const removePriority = (index: number) => {
    setForm((prev) => {
      const sp = [...prev.strategicPriorities];
      sp.splice(index, 1);
      return { ...prev, strategicPriorities: sp };
    });
  };

  const updatePriority = (
    index: number,
    field: keyof StrategicPriority,
    value: string,
  ) => {
    setForm((prev) => {
      const sp = [...prev.strategicPriorities];
      sp[index] = { ...sp[index], [field]: value };
      return { ...prev, strategicPriorities: sp };
    });
  };

  // ── Save ──────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.period.trim()) {
      alert('Tafadhali jaza kipindi cha taarifa.');
      return;
    }

    const title = form.title.trim() || `Ripoti ya Utendaji - ${form.period}`;

    if (editingId) {
      await db.performanceReports.update(editingId, {
        ...form,
        title,
        dateUpdated: new Date().toISOString(),
      });
    } else {
      await db.performanceReports.add({
        ...form,
        title,
        dateCreated: new Date().toISOString(),
        dateUpdated: new Date().toISOString(),
      });
    }

    setEditing(false);
    setEditingId(null);
    loadReports();
  };

  // ── Edit ──────────────────────────────────────────────────
  const handleEdit = (report: PerformanceReport) => {
    setForm({ ...report });
    setEditingId(report.id ?? null);
    setEditing(true);
  };

  // ── Delete ────────────────────────────────────────────────
  const handleDelete = async () => {
    if (deleteId) {
      await db.performanceReports.delete(deleteId);
      setDeleteId(null);
      loadReports();
    }
  };

  // ── New Report ────────────────────────────────────────────
  const handleNew = () => {
    setForm(emptyReport(currentUser, currentOrg));
    setEditingId(null);
    setEditing(true);
  };

  // ── Print / PDF ───────────────────────────────────────────
  const buildPrintContent = (r: PerformanceReport): string => {
    let html = '';

    // Report metadata block (important heading context)
    html += buildPrintTable(
      ['Kipengele', 'Taarifa'],
      [
        ['Aina ya Ripoti', r.title || 'Ripoti ya Utendaji'],
        ['Kipindi cha Ripoti', r.period || '\u2014'],
        ['Ngazi', ORG_LEVEL_LABELS[r.orgLevel]],
        ['Imetayarishwa na', r.authorName || '\u2014'],
        ['Wadhifa', r.authorRole || '\u2014'],
        ['Mawasiliano', r.authorPhone || r.authorEmail || '\u2014'],
        ['Tarehe ya Kutengenezwa', new Date(r.dateCreated).toLocaleString('sw-TZ')],
        ['Marekebisho ya Mwisho', new Date(r.dateUpdated).toLocaleString('sw-TZ')],
      ],
      { colAligns: ['left', 'left'] },
    );

    // Section A: Taarifa za Awali
    html +=
      '<h2 style="font-size:11pt;font-weight:bold;color:#166534;margin-top:16px;">SEHEMU A: TAARIFA ZA AWALI</h2>';

    html +=
      '<h3 style="font-size:10pt;font-weight:bold;margin-top:8px;">1.1 Taarifa za Eneo</h3>';
    html += buildPrintTable(
      ['Jambo', 'Maelezo'],
      [
        ['Mkoa', r.region],
        ['Wilaya', r.district],
        ['Kata', r.ward],
        ['Mtaa/Kijiji', r.street],
      ],
      { colAligns: ['left', 'left'] },
    );

    html +=
      '<h3 style="font-size:10pt;font-weight:bold;margin-top:12px;">1.2 Muundo wa Uongozi</h3>';
    const leaderRows = r.leaders.map((l) => [l.position, l.name, l.phone]);
    html += buildPrintTable(['Nafasi', 'Jina', 'Simu'], leaderRows, {
      colAligns: ['left', 'left', 'center'],
    });

    // Section B: Utangulizi
    html +=
      '<h2 style="font-size:11pt;font-weight:bold;color:#166534;margin-top:16px;">SEHEMU B: UTANGULIZI</h2>';
    html += `<p style="white-space:pre-wrap;margin-top:4px;">${r.introduction || '\u2014'}</p>`;

    // Section C: Utendaji wa Idara
    html +=
      '<h2 style="font-size:11pt;font-weight:bold;color:#166534;margin-top:16px;">SEHEMU C: UTENDAJI WA IDARA</h2>';

    for (const dk of DEPT_KEYS) {
      const dept = r[dk] as DepartmentReportData;
      const label = DEPT_LABELS[dk];
      html += `<h3 style="font-size:10pt;font-weight:bold;color:#166534;margin-top:12px;">Idara ya ${label}</h3>`;

      // Activities
      if (dept.activities.length > 0) {
        html +=
          '<p style="font-size:9pt;font-weight:bold;margin-top:8px;">Shughuli Zilizotekelezwa</p>';
        html += buildPrintTable(
          ['Shughuli', 'Eneo', 'Tarehe', 'Washiriki', 'Maelezo'],
          dept.activities.map((a) => [
            a.activity,
            a.area,
            a.date,
            String(a.participants),
            a.notes,
          ]),
          { colAligns: ['left', 'left', 'center', 'right', 'left'] },
        );
      }

      // Achievements
      if (dept.achievements.length > 0) {
        html +=
          '<p style="font-size:9pt;font-weight:bold;margin-top:8px;">Mafanikio</p>';
        html += buildPrintTable(
          ['Mfanikio', 'Maelezo'],
          dept.achievements.map((a) => [a.achievement, a.description]),
          { colAligns: ['left', 'left'] },
        );
      }

      // Challenges
      if (dept.challenges.length > 0) {
        html +=
          '<p style="font-size:9pt;font-weight:bold;margin-top:8px;">Changamoto</p>';
        html += buildPrintTable(
          ['Changamoto', 'Athari'],
          dept.challenges.map((c) => [c.challenge, c.impact]),
          { colAligns: ['left', 'left'] },
        );
      }

      // Recommendations
      if (dept.recommendations.length > 0) {
        html +=
          '<p style="font-size:9pt;font-weight:bold;margin-top:8px;">Mapendekezo</p>';
        html += buildPrintTable(
          ['Pendekezo', 'Hatua'],
          dept.recommendations.map((rec) => [rec.recommendation, rec.action]),
          { colAligns: ['left', 'left'] },
        );
      }

      // Uchumi-specific: Projects & Finance
      if (dk === 'uchumi') {
        if (dept.projects && dept.projects.length > 0) {
          html +=
            '<p style="font-size:9pt;font-weight:bold;margin-top:8px;">Miradi Inayoendelea</p>';
          html += buildPrintTable(
            ['Jina la Mradi', 'Maendeleo', 'Ufadhili', 'Hali'],
            dept.projects.map((p) => [p.name, p.progress, p.funding, p.status]),
            { colAligns: ['left', 'left', 'left', 'left'] },
          );
        }
        html +=
          '<p style="font-size:9pt;font-weight:bold;margin-top:8px;">Mapato na Matumizi</p>';
        html += buildPrintTable(
          ['Jambo', 'Kiasi'],
          [
            ['Mapato', formatPrintNum(dept.income ?? 0)],
            ['Matumizi', formatPrintNum(dept.expense ?? 0)],
            ['Salio', formatPrintNum(dept.balance ?? 0)],
          ],
          { colAligns: ['left', 'right'] },
        );
      }

      // Habari-specific: Communication
      if (dk === 'habari') {
        html +=
          '<p style="font-size:9pt;font-weight:bold;margin-top:8px;">Mfumo wa Mawasiliano</p>';
        html += buildPrintTable(
          ['Jambo', 'Maelezo'],
          [
            ['Vikundi vya WhatsApp', dept.whatsappGroups || '\u2014'],
            ['Mfumo wa Kidijitali', dept.digitalSystem || '\u2014'],
            ['Tovuti', dept.website || '\u2014'],
            ['Mitandao ya Kijamii', dept.socialMedia || '\u2014'],
            ['Mahitaji ya Mfumo', dept.systemNeeds || '\u2014'],
          ],
          { colAligns: ['left', 'left'] },
        );
      }
    }

    // Section D: Malengo ya Pamoja
    html +=
      '<h2 style="font-size:11pt;font-weight:bold;color:#166534;margin-top:16px;">SEHEMU D: MALENGO YA PAMOJA</h2>';

    if (r.goals.length > 0) {
      html +=
        '<p style="font-size:9pt;font-weight:bold;margin-top:8px;">Malengo ya Kipindi Kijacho</p>';
      html += buildPrintTable(
        ['Lengo', 'Muda', 'Mhusika'],
        r.goals.map((g) => [g.goal, g.timeline, g.responsible]),
        { colAligns: ['left', 'left', 'left'] },
      );
    }

    if (r.strategicPriorities.length > 0) {
      html +=
        '<p style="font-size:9pt;font-weight:bold;margin-top:8px;">Vipaumbele vya Kimkakati</p>';
      html += buildPrintTable(
        ['Kipaumbele', 'Maelezo'],
        r.strategicPriorities.map((sp) => [sp.priority, sp.description]),
        { colAligns: ['left', 'left'] },
      );
    }

    // Section E: Hitimisho
    html +=
      '<h2 style="font-size:11pt;font-weight:bold;color:#166534;margin-top:16px;">SEHEMU E: HITIMISHO</h2>';
    html += `<p style="white-space:pre-wrap;margin-top:4px;">${r.conclusion || '\u2014'}</p>`;

    // Signature - uses the verification section values for Mudir and Katibu only
    const mudirName = r.mudirName || currentOrg?.mudirName || '';
    const mudirSignature = r.mudirSignature || '';
    const katibuName = r.katibuName || '';
    const katibuSignature = r.katibuSignature || '';
    html +=
      '<div style="margin-top:40px;display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;">';
    html += `<div style="flex:1;min-width:220px;"><div style="font-size:9pt;font-weight:bold;margin-bottom:28px;">Mudir: ${mudirName || '_________________________'}</div><div style="font-size:9pt;">Sahihi: ${mudirSignature || '_________________________'}</div></div>`;
    html += `<div style="flex:1;min-width:220px;"><div style="font-size:9pt;font-weight:bold;margin-bottom:28px;">Katibu: ${katibuName || '_________________________'}</div><div style="font-size:9pt;">Sahihi: ${katibuSignature || '_________________________'}</div></div>`;
    html += '</div>';
    html += `<p style="text-align:center;margin-top:12px;font-size:9pt;">Tarehe: ${r.signatureDate || '_________________________'}</p>`;

    return html;
  };

  const handlePrint = (r: PerformanceReport) => {
    const orgInfo = `OFISI YA MUDIR \u2013 ${ORG_LEVEL_LABELS[r.orgLevel]} ${(currentOrg?.name ?? '').toUpperCase()}`;
    openReportPrintPreview({
      title: 'RIPOTI YA UTENDAJI',
      subtitle: `Kipindi: ${r.period} | Imetolewa: ${new Date(r.dateCreated).toLocaleString('sw-TZ')}`,
      orgInfo,
      orgLevel: ORG_LEVEL_LABELS[r.orgLevel],
      year: new Date(r.dateCreated).getFullYear(),
      contentHtml: buildPrintContent(r),
      hideSignatureArea: true,
    });
  };

  const handleDownloadPDF = (r: PerformanceReport) => {
    const orgInfo = `OFISI YA MUDIR \u2013 ${ORG_LEVEL_LABELS[r.orgLevel]} ${(currentOrg?.name ?? '').toUpperCase()}`;
    downloadReportPDF({
      title: 'RIPOTI YA UTENDAJI',
      subtitle: `Kipindi: ${r.period} | Imetolewa: ${new Date(r.dateCreated).toLocaleString('sw-TZ')}`,
      orgInfo,
      orgLevel: ORG_LEVEL_LABELS[r.orgLevel],
      year: new Date(r.dateCreated).getFullYear(),
      contentHtml: buildPrintContent(r),
      hideSignatureArea: true,
    });
  };

  // ── Render: Department Section ────────────────────────────
  const renderDeptSection = (deptKey: string) => {
    const dept = form[deptKey as keyof PerformanceReport] as DepartmentReportData;
    const isUchumi = deptKey === 'uchumi';
    const isHabari = deptKey === 'habari';

    return (
      <Accordion type="multiple" className="w-full">
        {/* Activities */}
        <AccordionItem value={`${deptKey}-activities`}>
          <AccordionTrigger className="text-sm font-semibold text-emerald-800 hover:no-underline">
            Shughuli Zilizotekelezwa
          </AccordionTrigger>
          <AccordionContent>
            <div className="overflow-x-auto -mx-2">
              <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
                <TableHeader>
                  <TableRow className="bg-emerald-700 hover:bg-emerald-700">
                    <TableHead className="text-white text-xs">Shughuli</TableHead>
                    <TableHead className="text-white text-xs">Eneo</TableHead>
                    <TableHead className="text-white text-xs">Tarehe</TableHead>
                    <TableHead className="text-white text-xs">Washiriki</TableHead>
                    <TableHead className="text-white text-xs">Maelezo</TableHead>
                    <TableHead className="text-white text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dept.activities.map((a, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Input
                          value={a.activity}
                          onChange={(e) =>
                            updateDeptItem(deptKey, 'activities', i, 'activity', e.target.value)
                          }
                          className="h-8 text-xs min-w-[120px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={a.area}
                          onChange={(e) =>
                            updateDeptItem(deptKey, 'activities', i, 'area', e.target.value)
                          }
                          className="h-8 text-xs min-w-[80px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          value={a.date}
                          onChange={(e) =>
                            updateDeptItem(deptKey, 'activities', i, 'date', e.target.value)
                          }
                          className="h-8 text-xs min-w-[120px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={a.participants || ''}
                          onChange={(e) =>
                            updateDeptItem(
                              deptKey,
                              'activities',
                              i,
                              'participants',
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="h-8 text-xs w-16"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={a.notes}
                          onChange={(e) =>
                            updateDeptItem(deptKey, 'activities', i, 'notes', e.target.value)
                          }
                          className="h-8 text-xs min-w-[100px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeDeptItem(deptKey, 'activities', i)}
                          className="h-7 w-7 p-0 text-red-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => addDeptItem(deptKey, 'activities')}
              className="mt-2 text-xs border-emerald-300 text-emerald-700"
            >
              <Plus className="h-3 w-3 mr-1" /> Ongeza Shughuli
            </Button>
          </AccordionContent>
        </AccordionItem>

        {/* Achievements */}
        <AccordionItem value={`${deptKey}-achievements`}>
          <AccordionTrigger className="text-sm font-semibold text-emerald-800 hover:no-underline">
            Mafanikio
          </AccordionTrigger>
          <AccordionContent>
            <div className="overflow-x-auto -mx-2">
              <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
                <TableHeader>
                  <TableRow className="bg-emerald-700 hover:bg-emerald-700">
                    <TableHead className="text-white text-xs">Mfanikio</TableHead>
                    <TableHead className="text-white text-xs">Maelezo</TableHead>
                    <TableHead className="text-white text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dept.achievements.map((a, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Input
                          value={a.achievement}
                          onChange={(e) =>
                            updateDeptItem(
                              deptKey,
                              'achievements',
                              i,
                              'achievement',
                              e.target.value,
                            )
                          }
                          className="h-8 text-xs min-w-[150px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={a.description}
                          onChange={(e) =>
                            updateDeptItem(
                              deptKey,
                              'achievements',
                              i,
                              'description',
                              e.target.value,
                            )
                          }
                          className="h-8 text-xs min-w-[150px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeDeptItem(deptKey, 'achievements', i)}
                          className="h-7 w-7 p-0 text-red-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => addDeptItem(deptKey, 'achievements')}
              className="mt-2 text-xs border-emerald-300 text-emerald-700"
            >
              <Plus className="h-3 w-3 mr-1" /> Ongeza Mfanikio
            </Button>
          </AccordionContent>
        </AccordionItem>

        {/* Challenges */}
        <AccordionItem value={`${deptKey}-challenges`}>
          <AccordionTrigger className="text-sm font-semibold text-emerald-800 hover:no-underline">
            Changamoto
          </AccordionTrigger>
          <AccordionContent>
            <div className="overflow-x-auto -mx-2">
              <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
                <TableHeader>
                  <TableRow className="bg-emerald-700 hover:bg-emerald-700">
                    <TableHead className="text-white text-xs">Changamoto</TableHead>
                    <TableHead className="text-white text-xs">Athari</TableHead>
                    <TableHead className="text-white text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dept.challenges.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Input
                          value={c.challenge}
                          onChange={(e) =>
                            updateDeptItem(
                              deptKey,
                              'challenges',
                              i,
                              'challenge',
                              e.target.value,
                            )
                          }
                          className="h-8 text-xs min-w-[150px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={c.impact}
                          onChange={(e) =>
                            updateDeptItem(deptKey, 'challenges', i, 'impact', e.target.value)
                          }
                          className="h-8 text-xs min-w-[150px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeDeptItem(deptKey, 'challenges', i)}
                          className="h-7 w-7 p-0 text-red-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => addDeptItem(deptKey, 'challenges')}
              className="mt-2 text-xs border-emerald-300 text-emerald-700"
            >
              <Plus className="h-3 w-3 mr-1" /> Ongeza Changamoto
            </Button>
          </AccordionContent>
        </AccordionItem>

        {/* Recommendations */}
        <AccordionItem value={`${deptKey}-recommendations`}>
          <AccordionTrigger className="text-sm font-semibold text-emerald-800 hover:no-underline">
            Mapendekezo
          </AccordionTrigger>
          <AccordionContent>
            <div className="overflow-x-auto -mx-2">
              <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
                <TableHeader>
                  <TableRow className="bg-emerald-700 hover:bg-emerald-700">
                    <TableHead className="text-white text-xs">Pendekezo</TableHead>
                    <TableHead className="text-white text-xs">Hatua</TableHead>
                    <TableHead className="text-white text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dept.recommendations.map((rec, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Input
                          value={rec.recommendation}
                          onChange={(e) =>
                            updateDeptItem(
                              deptKey,
                              'recommendations',
                              i,
                              'recommendation',
                              e.target.value,
                            )
                          }
                          className="h-8 text-xs min-w-[150px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={rec.action}
                          onChange={(e) =>
                            updateDeptItem(
                              deptKey,
                              'recommendations',
                              i,
                              'action',
                              e.target.value,
                            )
                          }
                          className="h-8 text-xs min-w-[150px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeDeptItem(deptKey, 'recommendations', i)}
                          className="h-7 w-7 p-0 text-red-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => addDeptItem(deptKey, 'recommendations')}
              className="mt-2 text-xs border-emerald-300 text-emerald-700"
            >
              <Plus className="h-3 w-3 mr-1" /> Ongeza Pendekezo
            </Button>
          </AccordionContent>
        </AccordionItem>

        {/* Uchumi-specific: Projects */}
        {isUchumi && (
          <AccordionItem value={`${deptKey}-projects`}>
            <AccordionTrigger className="text-sm font-semibold text-emerald-800 hover:no-underline">
              Miradi Inayoendelea
            </AccordionTrigger>
            <AccordionContent>
              <div className="overflow-x-auto -mx-2">
                <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
                  <TableHeader>
                    <TableRow className="bg-emerald-700 hover:bg-emerald-700">
                      <TableHead className="text-white text-xs">Jina la Mradi</TableHead>
                      <TableHead className="text-white text-xs">Maendeleo</TableHead>
                      <TableHead className="text-white text-xs">Ufadhili</TableHead>
                      <TableHead className="text-white text-xs">Hali</TableHead>
                      <TableHead className="text-white text-xs w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(dept.projects ?? []).map((p, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Input
                            value={p.name}
                            onChange={(e) =>
                              updateDeptItem(deptKey, 'projects', i, 'name', e.target.value)
                            }
                            className="h-8 text-xs min-w-[120px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={p.progress}
                            onChange={(e) =>
                              updateDeptItem(
                                deptKey,
                                'projects',
                                i,
                                'progress',
                                e.target.value,
                              )
                            }
                            className="h-8 text-xs min-w-[80px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={p.funding}
                            onChange={(e) =>
                              updateDeptItem(
                                deptKey,
                                'projects',
                                i,
                                'funding',
                                e.target.value,
                              )
                            }
                            className="h-8 text-xs min-w-[80px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={p.status}
                            onChange={(e) =>
                              updateDeptItem(deptKey, 'projects', i, 'status', e.target.value)
                            }
                            className="h-8 text-xs min-w-[80px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeDeptItem(deptKey, 'projects', i)}
                            className="h-7 w-7 p-0 text-red-500"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => addDeptItem(deptKey, 'projects')}
                className="mt-2 text-xs border-emerald-300 text-emerald-700"
              >
                <Plus className="h-3 w-3 mr-1" /> Ongeza Mradi
              </Button>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Uchumi-specific: Income/Expense */}
        {isUchumi && (
          <AccordionItem value={`${deptKey}-finance`}>
            <AccordionTrigger className="text-sm font-semibold text-emerald-800 hover:no-underline">
              Mapato na Matumizi
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs font-medium">Mapato</Label>
                  <Input
                    type="number"
                    value={dept.income || ''}
                    onChange={(e) => updateDept(deptKey, 'income', parseFloat(e.target.value) || 0)}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Matumizi</Label>
                  <Input
                    type="number"
                    value={dept.expense || ''}
                    onChange={(e) =>
                      updateDept(deptKey, 'expense', parseFloat(e.target.value) || 0)
                    }
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Salio</Label>
                  <Input
                    type="number"
                    value={(dept.income ?? 0) - (dept.expense ?? 0)}
                    readOnly
                    className="h-8 text-sm bg-muted"
                  />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Habari-specific: Communication */}
        {isHabari && (
          <AccordionItem value={`${deptKey}-communication`}>
            <AccordionTrigger className="text-sm font-semibold text-emerald-800 hover:no-underline">
              Mfumo wa Mawasiliano
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium">Vikundi vya WhatsApp</Label>
                  <Input
                    value={dept.whatsappGroups ?? ''}
                    onChange={(e) => updateDept(deptKey, 'whatsappGroups', e.target.value)}
                    className="h-8 text-sm"
                    placeholder="Idadi na majina ya vikundi"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Mfumo wa Kidijitali</Label>
                  <Input
                    value={dept.digitalSystem ?? ''}
                    onChange={(e) => updateDept(deptKey, 'digitalSystem', e.target.value)}
                    className="h-8 text-sm"
                    placeholder="Mfumo unaotumika"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Tovuti</Label>
                  <Input
                    value={dept.website ?? ''}
                    onChange={(e) => updateDept(deptKey, 'website', e.target.value)}
                    className="h-8 text-sm"
                    placeholder="URL ya tovuti"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Mitandao ya Kijamii</Label>
                  <Input
                    value={dept.socialMedia ?? ''}
                    onChange={(e) => updateDept(deptKey, 'socialMedia', e.target.value)}
                    className="h-8 text-sm"
                    placeholder="Instagram, X, n.k."
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs font-medium">Mahitaji ya Mfumo</Label>
                  <Textarea
                    value={dept.systemNeeds ?? ''}
                    onChange={(e) => updateDept(deptKey, 'systemNeeds', e.target.value)}
                    className="text-sm"
                    rows={2}
                    placeholder="Mahitaji ya mfumo wa habari"
                  />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    );
  };

  // ── Render: Report List ───────────────────────────────────
  if (!editing) {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-emerald-600" />
          <span className="ml-2 text-muted-foreground">Inapakia ripoti...</span>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-emerald-800 flex items-center gap-2">
              <ClipboardList className="h-6 w-6" />
              Ripoti ya Utendaji
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {currentOrg?.name ?? 'Taasisi'} (
              {currentOrg?.type ? ORG_LEVEL_LABELS[currentOrg.type] : ''})
            </p>
          </div>
          <Button
            onClick={handleNew}
            className="bg-emerald-700 hover:bg-emerald-800 text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            Unda Ripoti Mpya
          </Button>
        </div>

        {/* Report Cards */}
        {reports.length === 0 ? (
          <Card className="border-dashed border-emerald-200">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <ClipboardList className="h-12 w-12 text-emerald-300 mb-3" />
              <h3 className="text-lg font-semibold text-muted-foreground">
                Hakuna Ripoti ya Utendaji
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Anza kuunda ripoti mpya kwa kubofya kitufe kilicho juu.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {reports.map((r) => (
              <Card
                key={r.id}
                className="border border-emerald-100 hover:shadow-md transition-shadow"
              >
                <CardHeader className="pb-2">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base font-semibold text-emerald-800 truncate">
                        {r.title || 'Ripoti ya Utendaji'}
                      </CardTitle>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge
                          variant="secondary"
                          className="bg-emerald-100 text-emerald-700 text-xs"
                        >
                          {r.period}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-xs border-emerald-200"
                        >
                          {ORG_LEVEL_LABELS[r.orgLevel]}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(r)}
                        className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-800"
                        title="Hariri"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePrint(r)}
                        className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-800"
                        title="Chapa A4"
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownloadPDF(r)}
                        className="h-8 w-8 p-0 text-amber-600 hover:text-amber-800"
                        title="Hifadhi PDF"
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteId(r.id ?? null)}
                        className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                        title="Futa"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Imeundwa:{' '}
                      {new Date(r.dateCreated).toLocaleDateString('sw-TZ', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <span>Mwandishi: {r.authorName || '\u2014'}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Thibitisha Kufuta</DialogTitle>
              <DialogDescription>
                Una uhakika unataka kufuta ripoti hii? Kitendo hiki hakiwezi
                kubatilishwa.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteId(null)}>
                Ghairi
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                Futa
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ── Render: Edit Form ─────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Back button */}
      <Button
        variant="ghost"
        onClick={() => {
          setEditing(false);
          setEditingId(null);
        }}
        className="text-emerald-700 hover:text-emerald-900 -ml-2"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Rudi kwenye Orodha
      </Button>

      {/* Title */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-emerald-800">
          {editingId ? 'Hariri Ripoti ya Utendaji' : 'Unda Ripoti ya Utendaji'}
        </h2>
        <Button
          onClick={handleSave}
          className="bg-emerald-700 hover:bg-emerald-800 text-white"
        >
          <Save className="h-4 w-4 mr-2" />
          Hifadhi
        </Button>
      </div>

      {/* ── Taarifa za Jumla ───────────────────────────────── */}
      <Card className="border border-emerald-100">
        <CardHeader className="bg-emerald-50 border-b border-emerald-100 pb-3">
          <CardTitle className="text-base font-bold text-emerald-800">
            Taarifa za Jumla
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs font-medium">Ngazi</Label>
              <Input
                value={ORG_LEVEL_LABELS[form.orgLevel]}
                readOnly
                className="h-8 text-sm bg-muted"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">
                Jina la Tawi/Jimbo
              </Label>
              <Input
                value={currentOrg?.name ?? ''}
                readOnly
                className="h-8 text-sm bg-muted"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">
                Kipindi cha Taarifa *
              </Label>
              <Input
                value={form.period}
                onChange={(e) => updateField('period', e.target.value)}
                className="h-8 text-sm"
                placeholder="Mfano: Januari - Machi 2026"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">Kichwa cha Ripoti</Label>
              <Input
                value={form.title}
                onChange={(e) => updateField('title', e.target.value)}
                className="h-8 text-sm"
                placeholder="Kichwa cha ripoti (si lazima)"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs font-medium">Jina la Mwandishi</Label>
              <Input
                value={form.authorName}
                onChange={(e) => updateField('authorName', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">Wadhifa</Label>
              <Input
                value={form.authorRole}
                onChange={(e) => updateField('authorRole', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">Simu</Label>
              <Input
                value={form.authorPhone}
                onChange={(e) => updateField('authorPhone', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">Barua Pepe</Label>
              <Input
                value={form.authorEmail}
                onChange={(e) => updateField('authorEmail', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Sehemu A: Taarifa za Awali ─────────────────────── */}
      <Card className="border border-emerald-100">
        <CardHeader className="bg-emerald-50 border-b border-emerald-100 pb-3">
          <CardTitle className="text-base font-bold text-emerald-800">
            Sehemu A: Taarifa za Awali
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-6">
          {/* 1.1 Taarifa za Eneo */}
          <div>
            <h4 className="text-sm font-semibold text-emerald-700 mb-3">
              1.1 Taarifa za Eneo
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs font-medium">Mkoa</Label>
                <Input
                  value={form.region}
                  onChange={(e) => updateField('region', e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs font-medium">Wilaya</Label>
                <Input
                  value={form.district}
                  onChange={(e) => updateField('district', e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs font-medium">Kata</Label>
                <Input
                  value={form.ward}
                  onChange={(e) => updateField('ward', e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs font-medium">Mtaa/Kijiji</Label>
                <Input
                  value={form.street}
                  onChange={(e) => updateField('street', e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>

          {/* 1.2 Muundo wa Uongozi */}
          <div>
            <h4 className="text-sm font-semibold text-emerald-700 mb-3">
              1.2 Muundo wa Uongozi
            </h4>
            <div className="overflow-x-auto">
              <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
                <TableHeader>
                  <TableRow className="bg-emerald-700 hover:bg-emerald-700">
                    <TableHead className="text-white text-xs w-48">
                      Nafasi
                    </TableHead>
                    <TableHead className="text-white text-xs">Jina</TableHead>
                    <TableHead className="text-white text-xs w-40">
                      Simu
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {form.leaders.map((leader, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-xs text-emerald-800">
                        {leader.position}
                      </TableCell>
                      <TableCell>
                        <Input
                          value={leader.name}
                          onChange={(e) => updateLeader(i, 'name', e.target.value)}
                          className="h-8 text-xs"
                          placeholder="Jina la kiongozi"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={leader.phone}
                          onChange={(e) => updateLeader(i, 'phone', e.target.value)}
                          className="h-8 text-xs"
                          placeholder="Namba ya simu"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Sehemu B: Utangulizi ───────────────────────────── */}
      <Card className="border border-emerald-100">
        <CardHeader className="bg-emerald-50 border-b border-emerald-100 pb-3">
          <CardTitle className="text-base font-bold text-emerald-800">
            Sehemu B: Utangulizi
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <Textarea
            value={form.introduction}
            onChange={(e) => updateField('introduction', e.target.value)}
            className="text-sm min-h-[120px]"
            placeholder="Andika utangulizi wa ripoti hii..."
          />
        </CardContent>
      </Card>

      {/* ── Sehemu C: Utendaji wa Idara ────────────────────── */}
      <Card className="border border-emerald-100">
        <CardHeader className="bg-emerald-50 border-b border-emerald-100 pb-3">
          <CardTitle className="text-base font-bold text-emerald-800">
            Sehemu C: Utendaji wa Idara
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <Accordion type="multiple" className="w-full">
            {DEPT_KEYS.map((dk) => (
              <AccordionItem key={dk} value={`dept-${dk}`}>
                <AccordionTrigger className="text-sm font-bold text-emerald-800 hover:no-underline">
                  Idara ya {DEPT_LABELS[dk]}
                </AccordionTrigger>
                <AccordionContent>
                  {renderDeptSection(dk)}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      {/* ── Sehemu D: Malengo ya Pamoja ────────────────────── */}
      <Card className="border border-emerald-100">
        <CardHeader className="bg-emerald-50 border-b border-emerald-100 pb-3">
          <CardTitle className="text-base font-bold text-emerald-800">
            Sehemu D: Malengo ya Pamoja
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-6">
          {/* Goals */}
          <div>
            <h4 className="text-sm font-semibold text-emerald-700 mb-3">
              Malengo ya Kipindi Kijacho
            </h4>
            <div className="overflow-x-auto -mx-2">
              <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
                <TableHeader>
                  <TableRow className="bg-emerald-700 hover:bg-emerald-700">
                    <TableHead className="text-white text-xs">Lengo</TableHead>
                    <TableHead className="text-white text-xs">Muda</TableHead>
                    <TableHead className="text-white text-xs">Mhusika</TableHead>
                    <TableHead className="text-white text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {form.goals.map((g, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Input
                          value={g.goal}
                          onChange={(e) => updateGoal(i, 'goal', e.target.value)}
                          className="h-8 text-xs min-w-[150px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={g.timeline}
                          onChange={(e) =>
                            updateGoal(i, 'timeline', e.target.value)
                          }
                          className="h-8 text-xs min-w-[100px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={g.responsible}
                          onChange={(e) =>
                            updateGoal(i, 'responsible', e.target.value)
                          }
                          className="h-8 text-xs min-w-[100px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeGoal(i)}
                          className="h-7 w-7 p-0 text-red-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={addGoal}
              className="mt-2 text-xs border-emerald-300 text-emerald-700"
            >
              <Plus className="h-3 w-3 mr-1" /> Ongeza Lengo
            </Button>
          </div>

          {/* Strategic Priorities */}
          <div>
            <h4 className="text-sm font-semibold text-emerald-700 mb-3">
              Vipaumbele vya Kimkakati
            </h4>
            <div className="overflow-x-auto -mx-2">
              <Table className="[&_th]:border [&_td]:border [&_th]:border-emerald-400 [&_td]:border-emerald-300">
                <TableHeader>
                  <TableRow className="bg-emerald-700 hover:bg-emerald-700">
                    <TableHead className="text-white text-xs">
                      Kipaumbele
                    </TableHead>
                    <TableHead className="text-white text-xs">Maelezo</TableHead>
                    <TableHead className="text-white text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {form.strategicPriorities.map((sp, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Input
                          value={sp.priority}
                          onChange={(e) =>
                            updatePriority(i, 'priority', e.target.value)
                          }
                          className="h-8 text-xs min-w-[150px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={sp.description}
                          onChange={(e) =>
                            updatePriority(i, 'description', e.target.value)
                          }
                          className="h-8 text-xs min-w-[150px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removePriority(i)}
                          className="h-7 w-7 p-0 text-red-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={addPriority}
              className="mt-2 text-xs border-emerald-300 text-emerald-700"
            >
              <Plus className="h-3 w-3 mr-1" /> Ongeza Kipaumbele
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Sehemu E: Hitimisho ────────────────────────────── */}
      <Card className="border border-emerald-100">
        <CardHeader className="bg-emerald-50 border-b border-emerald-100 pb-3">
          <CardTitle className="text-base font-bold text-emerald-800">
            Sehemu E: Hitimisho
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div>
            <Label className="text-xs font-medium">Hitimisho</Label>
            <Textarea
              value={form.conclusion}
              onChange={(e) => updateField('conclusion', e.target.value)}
              className="text-sm min-h-[120px]"
              placeholder="Andika hitimisho la ripoti hii..."
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs font-medium">Jina la Mudir</Label>
              <Input
                value={form.mudirName}
                onChange={(e) => updateField('mudirName', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">Sahihi ya Mudir</Label>
              <Input
                value={form.mudirSignature || ''}
                onChange={(e) => updateField('mudirSignature', e.target.value)}
                className="h-8 text-sm"
                placeholder="Mfano: A. Aweso"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">Jina la Katibu</Label>
              <Input
                value={form.katibuName}
                onChange={(e) => updateField('katibuName', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">Sahihi ya Katibu</Label>
              <Input
                value={form.katibuSignature || ''}
                onChange={(e) => updateField('katibuSignature', e.target.value)}
                className="h-8 text-sm"
                placeholder="Mfano: M. Khamis"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">Tarehe ya Saini</Label>
              <Input
                type="date"
                value={form.signatureDate}
                onChange={(e) => updateField('signatureDate', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save button at bottom */}
      <div className="flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={() => {
            setEditing(false);
            setEditingId(null);
          }}
          className="border-emerald-300 text-emerald-700"
        >
          Ghairi
        </Button>
        <Button
          onClick={handleSave}
          className="bg-emerald-700 hover:bg-emerald-800 text-white"
        >
          <Save className="h-4 w-4 mr-2" />
          Hifadhi Ripoti
        </Button>
      </div>
    </div>
  );
}
