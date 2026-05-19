'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api-client';
import { db, logAudit } from '@/lib/db-offline';
import { useAuthStore } from '@/lib/store';
import type { User, OrgUnit, UserRole, OrgLevel } from '@/lib/types';
import { ROLE_CONFIG, ORG_LEVEL_CONFIG } from '@/lib/types';
import AuditDashboard from '@/components/admin/AuditDashboard';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import {
  Shield,
  Users,
  Building2,
  FileText,
  Settings,
  BarChart3,
  Search,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Ban,
  CheckCircle,
  XCircle,
  Activity,
  Database,
  Download,
  Upload,
  Trash2,
  Loader2,
  TreePine,
  Eye,
  ToggleLeft,
  ToggleRight,
  ClipboardList,
  ArrowUpDown,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Helper Constants ──────────────────────────────────────

const ORG_LABELS: Record<OrgLevel, string> = {
  markaz: 'Markaz Kuu',
  jimbo: 'Jimbo',
  tawi: 'Tawi',
};

const ORG_COLORS: Record<OrgLevel, string> = {
  markaz: 'bg-emerald-700 text-white',
  jimbo: 'bg-emerald-500 text-white',
  tawi: 'bg-emerald-300 text-emerald-900',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-rose-100 text-rose-700 border-rose-200',
  muhasibu: 'bg-amber-100 text-amber-700 border-amber-200',
  mweka_hazina: 'bg-teal-100 text-teal-700 border-teal-200',
  mudir: 'bg-blue-100 text-blue-700 border-blue-200',
  katibu: 'bg-violet-100 text-violet-700 border-violet-200',
  mkaguzi: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'Kuunda',
  update: 'Kuhariri',
  delete: 'Kufuta',
  login: 'Kuingia',
  logout: 'Kutoka',
  deactivate: 'Kusitisha',
  activate: 'Kuwasha',
  import: 'Kupakia',
  export: 'Kuhamisha',
  submit: 'Kuwasilisha',
};

const DB_SIZE_LIMIT_MB = 50; // IndexedDB typical limit indicator

// ── Format helpers ────────────────────────────────────────

function formatNumber(n: number): string {
  return n.toLocaleString('sw-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('sw-TZ', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── Stat Card Component ───────────────────────────────────

function StatCard({
  title,
  value,
  icon: Icon,
  description,
  color = 'emerald',
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  description?: string;
  color?: string;
}) {
  const colorMap: Record<string, { bg: string; icon: string; text: string }> = {
    emerald: { bg: 'bg-emerald-100 dark:bg-emerald-900/40', icon: 'text-emerald-600 dark:text-emerald-400', text: 'text-emerald-800 dark:text-emerald-300' },
    blue: { bg: 'bg-sky-100 dark:bg-sky-900/40', icon: 'text-sky-600 dark:text-sky-400', text: 'text-sky-800 dark:text-sky-300' },
    amber: { bg: 'bg-amber-100 dark:bg-amber-900/40', icon: 'text-amber-600 dark:text-amber-400', text: 'text-amber-800 dark:text-amber-300' },
    rose: { bg: 'bg-rose-100 dark:bg-rose-900/40', icon: 'text-rose-600 dark:text-rose-400', text: 'text-rose-800 dark:text-rose-300' },
    violet: { bg: 'bg-violet-100 dark:bg-violet-900/40', icon: 'text-violet-600 dark:text-violet-400', text: 'text-violet-800 dark:text-violet-300' },
    teal: { bg: 'bg-teal-100 dark:bg-teal-900/40', icon: 'text-teal-600 dark:text-teal-400', text: 'text-teal-800 dark:text-teal-300' },
  };
  const c = colorMap[color] || colorMap.emerald;

  return (
    <Card className="border-emerald-100 dark:border-emerald-900 hover:shadow-md transition-shadow">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center gap-4">
          <div className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 ${c.bg}`}>
            <Icon className={`h-6 w-6 ${c.icon}`} />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground truncate">{title}</p>
            <p className={`text-2xl font-bold ${c.text}`}>{value}</p>
            {description && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{description}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Main AdminPanel Component
// ============================================================

export default function AdminPanel() {
  const { currentUser } = useAuthStore();

  // ── Shared state ──────────────────────────────────────
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  // ── Overview state ─────────────────────────────────────
  const [overviewStats, setOverviewStats] = useState({
    markazCount: 0,
    jimboCount: 0,
    tawiCount: 0,
    totalOrgUnits: 0,
    adminCount: 0,
    muhasibuCount: 0,
    mwekaHazinaCount: 0,
    mudirCount: 0,
    katibuCount: 0,
    mkaguziCount: 0,
    totalUsers: 0,
    activeUsers: 0,
    totalTransactions: 0,
    totalIncome: 0,
    totalExpense: 0,
    dbSizeMB: 0,
  });

  // ── User management state ──────────────────────────────
  const [users, setUsers] = useState<User[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userFilterRole, setUserFilterRole] = useState<string>('all');
  const [userFilterLevel, setUserFilterLevel] = useState<string>('all');

  // ── Organization management state ──────────────────────
  const [orgTree, setOrgTree] = useState<OrgUnit[]>([]);
  const [childrenMap, setChildrenMap] = useState<Record<number, OrgUnit[]>>({});
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [txnCountMap, setTxnCountMap] = useState<Record<number, number>>({});

  // Org edit/add dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addParent, setAddParent] = useState<OrgUnit | null>(null);
  const [addName, setAddName] = useState('');
  const [addCode, setAddCode] = useState('');

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editOrg, setEditOrg] = useState<OrgUnit | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');

  // ── Audit log state ────────────────────────────────────
  // AuditDashboard is now a separate component with its own state

  // ── System settings state ──────────────────────────────
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  // ── Load overview data ─────────────────────────────────
  const loadOverview = useCallback(async () => {
    try {
      let allOrgs: any[] = [];
      let allUsers: any[] = [];
      let totalIncome = 0;
      let totalExpense = 0;
      let totalTransactions = 0;

      try {
        // Use API endpoints
        const [orgResult, userResult, txnResult] = await Promise.all([
          apiGet<{ success: boolean; data: any[] }>('/api/organizations', { limit: 500 }),
          apiGet<{ success: boolean; data: any[] }>('/api/users', { limit: 500 }),
          apiGet<{ success: boolean; data: any[]; pagination?: any }>('/api/transactions', { limit: 1 }),
        ]);
        allOrgs = orgResult.data || [];
        allUsers = userResult.data || [];
        // Get financial stats from a dashboard call for the first org
        if (allOrgs.length > 0) {
          try {
            const dashResult = await apiGet<{ data: { summary: { totalIncome: number; totalExpense: number; transactionCount: number } } }>('/api/dashboard', {
              orgUnitId: allOrgs[0].id,
              year: new Date().getFullYear(),
            });
            totalIncome = dashResult.data?.summary?.totalIncome || 0;
            totalExpense = dashResult.data?.summary?.totalExpense || 0;
            totalTransactions = dashResult.data?.summary?.transactionCount || 0;
          } catch {
            // Dashboard stats not available, use 0
          }
        }
        totalTransactions = txnResult.pagination?.total || totalTransactions;
      } catch (apiError) {
        console.warn('API failed, falling back to offline DB:', apiError);
        const [orgs, users, txns] = await Promise.all([
          db.orgUnits.toArray(),
          db.users.toArray(),
          db.transactions.toArray(),
        ]);
        allOrgs = orgs;
        allUsers = users;
        totalIncome = txns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        totalExpense = txns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        totalTransactions = txns.length;
      }

      const markazCount = allOrgs.filter((o) => o.type === 'markaz').length;
      const jimboCount = allOrgs.filter((o) => o.type === 'jimbo').length;
      const tawiCount = allOrgs.filter((o) => o.type === 'tawi').length;

      const roleCounts: Record<string, number> = {};
      for (const u of allUsers) {
        roleCounts[u.role] = (roleCounts[u.role] || 0) + 1;
      }

      // Estimate DB size
      let dbSizeMB = 0;
      try {
        const estimate = await navigator.storage?.estimate?.();
        if (estimate?.usage) {
          dbSizeMB = Number((estimate.usage / (1024 * 1024)).toFixed(2));
        }
      } catch {
        dbSizeMB = 0;
      }

      setOverviewStats({
        markazCount,
        jimboCount,
        tawiCount,
        totalOrgUnits: allOrgs.length,
        adminCount: roleCounts['admin'] || 0,
        muhasibuCount: roleCounts['muhasibu'] || 0,
        mwekaHazinaCount: roleCounts['mweka_hazina'] || 0,
        mudirCount: roleCounts['mudir'] || 0,
        katibuCount: roleCounts['katibu'] || 0,
        mkaguziCount: roleCounts['mkaguzi'] || 0,
        totalUsers: allUsers.length,
        activeUsers: allUsers.filter((u: any) => u.isActive).length,
        totalTransactions,
        totalIncome,
        totalExpense,
        dbSizeMB,
      });
    } catch (error) {
      console.error('Error loading overview:', error);
    }
  }, []);

  // ── Load users ─────────────────────────────────────────
  const loadUsers = useCallback(async () => {
    try {
      try {
        const [userResult, orgResult] = await Promise.all([
          apiGet<{ success: boolean; data: any[] }>('/api/users', { limit: 500 }),
          apiGet<{ success: boolean; data: any[] }>('/api/organizations', { limit: 500 }),
        ]);
        const mappedUsers: User[] = (userResult.data || []).map((u: any) => ({
          id: u.id,
          username: u.username,
          email: u.email || '',
          password: '',
          fullName: u.fullName,
          role: u.role as UserRole,
          orgLevel: u.orgLevel as OrgLevel,
          orgUnitId: u.orgUnitId,
          securityQuestion: u.securityQuestion || '',
          securityAnswer: '',
          isActive: u.isActive,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        }));
        const mappedOrgs: OrgUnit[] = (orgResult.data || []).map((o: any) => ({
          id: o.id,
          name: o.name,
          type: o.type as OrgLevel,
          parentId: o.parentId,
          code: o.code,
          isActive: o.isActive,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        }));
        setUsers(mappedUsers);
        setOrgUnits(mappedOrgs);
      } catch (apiError) {
        console.warn('API failed, falling back to offline DB:', apiError);
        const [allUsers, allOrgs] = await Promise.all([
          db.users.toArray(),
          db.orgUnits.toArray(),
        ]);
        setUsers(allUsers);
        setOrgUnits(allOrgs);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    }
  }, []);

  // ── Load org tree ──────────────────────────────────────
  const loadOrgTree = useCallback(async () => {
    try {
      let allOrgs: OrgUnit[];
      let countMap: Record<number, number> = {};

      try {
        const result = await apiGet<{ success: boolean; data: any[] }>('/api/organizations', { limit: 500 });
        allOrgs = (result.data || []).map((o: any) => ({
          id: o.id,
          name: o.name,
          type: o.type as OrgLevel,
          parentId: o.parentId,
          code: o.code,
          isActive: o.isActive,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        }));
        // Transaction counts from _count field
        for (const o of result.data || []) {
          if (o._count?.transactions !== undefined) {
            countMap[o.id] = o._count.transactions;
          }
        }
      } catch (apiError) {
        console.warn('API failed, falling back to offline DB:', apiError);
        allOrgs = await db.orgUnits.toArray();
        const allTxns = await db.transactions.toArray();
        for (const t of allTxns) {
          countMap[t.orgUnitId] = (countMap[t.orgUnitId] || 0) + 1;
        }
      }

      const markazList = allOrgs!.filter((o) => o.type === 'markaz');

      const cMap: Record<number, OrgUnit[]> = {};
      for (const org of allOrgs!) {
        if (org.parentId !== null) {
          if (!cMap[org.parentId]) cMap[org.parentId] = [];
          cMap[org.parentId].push(org);
        }
      }

      setOrgTree(markazList);
      setChildrenMap(cMap);
      setTxnCountMap(countMap);

      // Auto-expand markaz
      const expanded = new Set<number>();
      markazList.forEach((m) => expanded.add(m.id!));
      setExpandedIds(expanded);
    } catch (error) {
      console.error('Error loading org tree:', error);
    }
  }, []);

  // ── Load audit logs ────────────────────────────────────
  // AuditDashboard handles its own data fetching

  // ── Load all data ──────────────────────────────────────
  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadOverview(), loadUsers(), loadOrgTree()]);
    } finally {
      setLoading(false);
    }
  }, [loadOverview, loadUsers, loadOrgTree]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // ── Get org name by id ─────────────────────────────────
  const getOrgName = (orgUnitId: number): string => {
    const org = orgUnits.find((o) => o.id === orgUnitId);
    return org?.name || `Kitengo #${orgUnitId}`;
  };

  // ══════════════════════════════════════════════════════════
  // TAB 1: SYSTEM OVERVIEW
  // ══════════════════════════════════════════════════════════

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Org Unit Stats */}
      <div>
        <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Vitengo vya Taasisi
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Markaz Kuu"
            value={overviewStats.markazCount}
            icon={Building2}
            description="Makao makuu"
            color="emerald"
          />
          <StatCard
            title="Majimbo"
            value={overviewStats.jimboCount}
            icon={Building2}
            description="Majimbo yote"
            color="teal"
          />
          <StatCard
            title="Matawi"
            value={overviewStats.tawiCount}
            icon={Building2}
            description="Matawi yote"
            color="blue"
          />
          <StatCard
            title="Jumla Vitengo"
            value={overviewStats.totalOrgUnits}
            icon={TreePine}
            description="Vitengo vyote vya taasisi"
            color="violet"
          />
        </div>
      </div>

      {/* User Stats */}
      <div>
        <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Users className="h-4 w-4" />
          Watumiaji kwa Nafasi
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard
            title="Wamsimamizi"
            value={overviewStats.adminCount}
            icon={Shield}
            color="rose"
          />
          <StatCard
            title="Wahasibu"
            value={overviewStats.muhasibuCount}
            icon={ClipboardList}
            color="amber"
          />
          <StatCard
            title="Weka Hazina"
            value={overviewStats.mwekaHazinaCount}
            icon={Database}
            color="teal"
          />
          <StatCard
            title="Wadir"
            value={overviewStats.mudirCount}
            icon={Eye}
            color="blue"
          />
          <StatCard
            title="Wakatibu"
            value={overviewStats.katibuCount}
            icon={FileText}
            color="violet"
          />
          <StatCard
            title="Wakaguzi"
            value={overviewStats.mkaguziCount}
            icon={Activity}
            color="emerald"
          />
        </div>
      </div>

      {/* Transaction & DB Stats */}
      <div>
        <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider mb-3 flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Miamala na Hifadhi
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Jumla Watumiaji"
            value={overviewStats.totalUsers}
            icon={Users}
            description={`${overviewStats.activeUsers} wanaohutumika`}
            color="emerald"
          />
          <StatCard
            title="Jumla Miamala"
            value={formatNumber(overviewStats.totalTransactions)}
            icon={ClipboardList}
            description="Miamala yote kwenye mfumo"
            color="teal"
          />
          <StatCard
            title="Jumla Mapato"
            value={`TZS ${formatNumber(overviewStats.totalIncome)}`}
            icon={BarChart3}
            color="blue"
          />
          <StatCard
            title="Jumla Matumizi"
            value={`TZS ${formatNumber(overviewStats.totalExpense)}`}
            icon={BarChart3}
            color="rose"
          />
        </div>
      </div>

      {/* Database Size Indicator */}
      <Card className="border-emerald-100 dark:border-emerald-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
            <Database className="h-5 w-5" />
            Ukubwa wa Hifadhi (Database)
          </CardTitle>
          <CardDescription>Matumizi ya hifadhi kwenye kifaa chako</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Ukubwa uliotumika</span>
              <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                {overviewStats.dbSizeMB} MB / {DB_SIZE_LIMIT_MB} MB
              </span>
            </div>
            <Progress
              value={Math.min((overviewStats.dbSizeMB / DB_SIZE_LIMIT_MB) * 100, 100)}
              className="h-3"
            />
            <p className="text-xs text-muted-foreground">
              {overviewStats.dbSizeMB < DB_SIZE_LIMIT_MB * 0.5
                ? 'Hifadhi iko salama. Kuna nafasi ya kutosha.'
                : overviewStats.dbSizeMB < DB_SIZE_LIMIT_MB * 0.8
                ? 'Hifadhi inakaribia kujaa. Fikiria kuhamisha data.'
                : 'Hifadhi inakaribia kujaa! Hamisha data haraka.'}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // TAB 2: USER MANAGEMENT
  // ══════════════════════════════════════════════════════════

  const filteredUsers = users.filter((u) => {
    // Search filter
    if (userSearch.trim()) {
      const q = userSearch.toLowerCase();
      const matchesName = u.fullName.toLowerCase().includes(q);
      const matchesEmail = u.email?.toLowerCase().includes(q);
      const matchesUsername = u.username.toLowerCase().includes(q);
      if (!matchesName && !matchesEmail && !matchesUsername) return false;
    }
    // Role filter
    if (userFilterRole !== 'all' && u.role !== userFilterRole) return false;
    // Level filter
    if (userFilterLevel !== 'all' && u.orgLevel !== userFilterLevel) return false;
    return true;
  });

  const handleToggleUserActive = async (user: User) => {
    try {
      const newActive = !user.isActive;

      try {
        if (newActive) {
          await apiPut(`/api/users/${user.id}`, { isActive: true });
        } else {
          await apiDelete(`/api/users/${user.id}`);
        }
      } catch (apiError) {
        console.warn('API failed, falling back to offline DB:', apiError);
        await db.users.update(user.id!, {
          isActive: newActive,
          updatedAt: new Date().toISOString(),
        });
        if (currentUser?.id) {
          await logAudit(
            newActive ? 'activate' : 'deactivate',
            'user',
            user.id!,
            currentUser.id,
            `Mtumiaji "${user.fullName}" ${newActive ? 'amewashwa' : 'amesitishwa'}`
          );
        }
      }

      toast.success(
        newActive
          ? `Mtumiaji "${user.fullName}" amewashwa kikamilifu!`
          : `Mtumiaji "${user.fullName}" amesitishwa.`,
        {
          icon: newActive ? (
            <CheckCircle className="h-4 w-4 text-emerald-600" />
          ) : (
            <Ban className="h-4 w-4 text-red-600" />
          ),
        }
      );
      await loadUsers();
      await loadOverview();
    } catch (error) {
      toast.error('Hitilafu katika kubadilisha hali ya mtumiaji', {
        description: 'Tafadhali jaribu tena.',
      });
    }
  };

  const renderUserManagement = () => (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="border-emerald-100 dark:border-emerald-900">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tafuta kwa jina au barua pepe..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="pl-9 border-emerald-200 focus:border-emerald-500"
              />
            </div>
            <Select value={userFilterRole} onValueChange={setUserFilterRole}>
              <SelectTrigger className="w-full sm:w-[180px] border-emerald-200">
                <SelectValue placeholder="Nafasi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Nafasi Zote</SelectItem>
                {Object.entries(ROLE_CONFIG).map(([role, config]) => (
                  <SelectItem key={role} value={role}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={userFilterLevel} onValueChange={setUserFilterLevel}>
              <SelectTrigger className="w-full sm:w-[180px] border-emerald-200">
                <SelectValue placeholder="Ngazi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Ngazi Zote</SelectItem>
                <SelectItem value="markaz">Markaz Kuu</SelectItem>
                <SelectItem value="jimbo">Jimbo</SelectItem>
                <SelectItem value="tawi">Tawi</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Inaonyesha {filteredUsers.length} kati ya {users.length} mtumiaji
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card className="border-emerald-100 dark:border-emerald-900">
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-emerald-200 scrollbar-track-transparent">
            <Table>
              <TableHeader>
                <TableRow className="bg-emerald-700 hover:bg-emerald-700 sticky top-0 z-10">
                  <TableHead className="text-white font-semibold">Jina Kamili</TableHead>
                  <TableHead className="text-white font-semibold">Barua Pepe</TableHead>
                  <TableHead className="text-white font-semibold">Nafasi</TableHead>
                  <TableHead className="text-white font-semibold">Ngazi</TableHead>
                  <TableHead className="text-white font-semibold">Kitengo</TableHead>
                  <TableHead className="text-white font-semibold">Hali</TableHead>
                  <TableHead className="text-white font-semibold text-right">Vitendo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      Hakuna watumiaji walipopatikana
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((user) => (
                    <TableRow
                      key={user.id}
                      className={`hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors ${
                        !user.isActive ? 'opacity-60' : ''
                      }`}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                              {user.fullName
                                .split(' ')
                                .map((n) => n[0])
                                .join('')
                                .toUpperCase()
                                .slice(0, 2)}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{user.fullName}</p>
                            <p className="text-xs text-muted-foreground truncate">@{user.username}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground truncate max-w-[180px]">
                        {user.email || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={ROLE_COLORS[user.role] || 'border-emerald-200 text-emerald-700'}
                        >
                          {ROLE_CONFIG[user.role]?.label || user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={ORG_COLORS[user.orgLevel]}>
                          {ORG_LABELS[user.orgLevel]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm max-w-[150px] truncate">
                        {getOrgName(user.orgUnitId)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={user.isActive ? 'default' : 'destructive'}
                          className={
                            user.isActive
                              ? 'bg-emerald-600 hover:bg-emerald-700'
                              : ''
                          }
                        >
                          {user.isActive ? 'Hai' : 'Haihai'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className={
                            user.isActive
                              ? 'h-8 px-2 text-red-600 hover:text-red-800 hover:bg-red-50'
                              : 'h-8 px-2 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50'
                          }
                          onClick={() => handleToggleUserActive(user)}
                          title={user.isActive ? 'Sitisha' : 'Washa'}
                        >
                          {user.isActive ? (
                            <ToggleLeft className="h-4 w-4" />
                          ) : (
                            <ToggleRight className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // TAB 3: ORGANIZATION MANAGEMENT
  // ══════════════════════════════════════════════════════════

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddOrg = async () => {
    if (!addParent || !addName.trim() || !addCode.trim()) return;

    const childType: OrgLevel = addParent.type === 'markaz' ? 'jimbo' : 'tawi';

    try {
      await apiPost('/api/organizations', {
        name: addName.trim(),
        type: childType,
        parentId: addParent.id!,
        code: addCode.trim().toUpperCase(),
      });
    } catch (apiError) {
      console.warn('API failed, falling back to offline DB:', apiError);
      await db.orgUnits.add({
        name: addName.trim(),
        code: addCode.trim().toUpperCase(),
        type: childType,
        parentId: addParent.id!,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      if (currentUser?.id) {
        await logAudit(
          'create',
          'orgUnit',
          addParent.id!,
          currentUser.id,
          `Kitengo kipya "${addName.trim()}" (${childType}) kimeongezwa chini ya ${addParent.name}`
        );
      }
    }

    setAddDialogOpen(false);
    setAddName('');
    setAddCode('');
    setAddParent(null);

    toast.success(`Kitengo "${addName.trim()}" kimeongezwa kikamilifu!`);
    await loadOrgTree();
    await loadOverview();
  };

  const handleEditOrg = async () => {
    if (!editOrg || !editName.trim() || !editCode.trim()) return;

    try {
      await apiPut(`/api/organizations/${editOrg.id}`, {
        name: editName.trim(),
        code: editCode.trim().toUpperCase(),
      });
    } catch (apiError) {
      console.warn('API failed, falling back to offline DB:', apiError);
      await db.orgUnits.update(editOrg.id!, {
        name: editName.trim(),
        code: editCode.trim().toUpperCase(),
        updatedAt: new Date().toISOString(),
      });
      if (currentUser?.id) {
        await logAudit(
          'update',
          'orgUnit',
          editOrg.id!,
          currentUser.id,
          `Kitengo "${editOrg.name}" kimehaririwa kuwa "${editName.trim()}"`
        );
      }
    }

    setEditDialogOpen(false);
    setEditOrg(null);
    setEditName('');
    setEditCode('');

    toast.success('Kitengo kimehaririwa kikamilifu!');
    await loadOrgTree();
    await loadOverview();
  };

  const handleDeactivateOrg = async (org: OrgUnit) => {
    try {
      try {
        await apiDelete(`/api/organizations/${org.id}`);
      } catch (apiError) {
        console.warn('API failed, falling back to offline DB:', apiError);
        await db.orgUnits.update(org.id!, {
          isActive: false,
          updatedAt: new Date().toISOString(),
        });
        if (currentUser?.id) {
          await logAudit(
            'deactivate',
            'orgUnit',
            org.id!,
            currentUser.id,
            `Kitengo "${org.name}" kimesitishwa`
          );
        }
      }

      toast.info(`Kitengo "${org.name}" kimesitishwa.`);
      await loadOrgTree();
      await loadOverview();
    } catch (error) {
      toast.error('Hitilafu katika kusitisha kitengo');
    }
  };

  const getChildTypeLabel = (parent: OrgUnit): string => {
    if (parent.type === 'markaz') return 'Jimbo';
    if (parent.type === 'jimbo') return 'Tawi';
    return '';
  };

  const renderOrgRow = (org: OrgUnit, depth: number = 0) => {
    const children = childrenMap[org.id!] || [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(org.id!);
    const indent = depth * 32;
    const txnCount = txnCountMap[org.id!] || 0;

    return (
      <Fragment key={org.id}>
        <TableRow
          className={`cursor-pointer hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors ${
            !org.isActive ? 'opacity-50' : ''
          }`}
        >
          <TableCell className="w-10">
            {hasChildren ? (
              <button
                onClick={() => toggleExpand(org.id!)}
                className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900 rounded"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-emerald-700" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-emerald-700" />
                )}
              </button>
            ) : (
              <span className="inline-block w-6" />
            )}
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-2" style={{ paddingLeft: indent }}>
              <Badge className={ORG_COLORS[org.type]}>{ORG_LABELS[org.type]}</Badge>
              <span className="font-medium text-sm">{org.name}</span>
            </div>
          </TableCell>
          <TableCell className="text-muted-foreground font-mono text-sm">
            {org.code}
          </TableCell>
          <TableCell className="text-center">
            <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
              {formatNumber(txnCount)}
            </Badge>
          </TableCell>
          <TableCell className="text-center">
            {hasChildren ? (
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                {children.length}
              </Badge>
            ) : (
              <span className="text-muted-foreground text-sm">&mdash;</span>
            )}
          </TableCell>
          <TableCell>
            <Badge
              variant={org.isActive ? 'default' : 'destructive'}
              className={org.isActive ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            >
              {org.isActive ? 'Inayotumika' : 'Haitumiki'}
            </Badge>
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-1">
              {org.type !== 'tawi' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50"
                  onClick={() => {
                    setAddParent(org);
                    setAddName('');
                    setAddCode('');
                    setAddDialogOpen(true);
                  }}
                  title={`Ongeza ${getChildTypeLabel(org)}`}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-amber-600 hover:text-amber-800 hover:bg-amber-50"
                onClick={() => {
                  setEditOrg(org);
                  setEditName(org.name);
                  setEditCode(org.code);
                  setEditDialogOpen(true);
                }}
                title="Hariri"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              {org.isActive && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-red-600 hover:text-red-800 hover:bg-red-50"
                  onClick={() => handleDeactivateOrg(org)}
                  title="Sitisha"
                >
                  <Ban className="h-4 w-4" />
                </Button>
              )}
            </div>
          </TableCell>
        </TableRow>
        {isExpanded && children.map((child) => renderOrgRow(child, depth + 1))}
      </Fragment>
    );
  };

  const renderOrganizationManagement = () => (
    <div className="space-y-4">
      <Card className="border-emerald-100 dark:border-emerald-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
            <TreePine className="h-5 w-5" />
            Mti wa Vitengo (Hierarchy)
          </CardTitle>
          <CardDescription>
            Bonyeza kivinjari kupanua/kunyima. Muundo: Markaz Kuu &rarr; Jimbo &rarr; Tawi
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-emerald-200 scrollbar-track-transparent">
            <Table>
              <TableHeader>
                <TableRow className="bg-emerald-700 hover:bg-emerald-700 sticky top-0 z-10">
                  <TableHead className="text-white font-semibold w-10" />
                  <TableHead className="text-white font-semibold">Jina</TableHead>
                  <TableHead className="text-white font-semibold">Msimbo</TableHead>
                  <TableHead className="text-white font-semibold text-center">Miamala</TableHead>
                  <TableHead className="text-white font-semibold text-center">Vidogo</TableHead>
                  <TableHead className="text-white font-semibold">Hali</TableHead>
                  <TableHead className="text-white font-semibold">Vitendo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgTree.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      <Building2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      Hakuna vitengo vya taasisi bado
                    </TableCell>
                  </TableRow>
                ) : (
                  orgTree.map((markaz) => renderOrgRow(markaz, 0))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add Org Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-emerald-800">
              Ongeza {addParent ? getChildTypeLabel(addParent) : 'Kitengo'}
            </DialogTitle>
            <DialogDescription>
              {addParent
                ? `Kuongeza ${getChildTypeLabel(addParent).toLowerCase()} chini ya ${addParent.name}`
                : 'Fomu ya kuongeza kitengo kipya'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="add-org-jina" className="text-sm font-medium">Jina</Label>
              <Input
                id="add-org-jina"
                placeholder="Ingiza jina la kitengo"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                className="border-emerald-200 focus:border-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-org-msimbo" className="text-sm font-medium">Msimbo</Label>
              <Input
                id="add-org-msimbo"
                placeholder="Ingiza msimbo wa kitengo"
                value={addCode}
                onChange={(e) => setAddCode(e.target.value.toUpperCase())}
                className="border-emerald-200 focus:border-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Aina</Label>
              <Input
                value={addParent ? getChildTypeLabel(addParent) : '—'}
                disabled
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Chini ya</Label>
              <Input
                value={addParent ? `${addParent.name} (${addParent.code})` : '—'}
                disabled
                className="bg-muted"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Ghairi</Button>
            </DialogClose>
            <Button
              onClick={handleAddOrg}
              disabled={!addName.trim() || !addCode.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Plus className="h-4 w-4 mr-1" />
              Ongeza
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Org Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-emerald-800">Hariri Kitengo</DialogTitle>
            <DialogDescription>Badilisha jina au msimbo wa kitengo</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-org-jina" className="text-sm font-medium">Jina</Label>
              <Input
                id="edit-org-jina"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="border-emerald-200 focus:border-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-org-msimbo" className="text-sm font-medium">Msimbo</Label>
              <Input
                id="edit-org-msimbo"
                value={editCode}
                onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                className="border-emerald-200 focus:border-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Aina</Label>
              <Input
                value={editOrg ? ORG_LABELS[editOrg.type] : '—'}
                disabled
                className="bg-muted"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Ghairi</Button>
            </DialogClose>
            <Button
              onClick={handleEditOrg}
              disabled={!editName.trim() || !editCode.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Pencil className="h-4 w-4 mr-1" />
              Hifadhi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // TAB 4: AUDIT LOG (Now uses AuditDashboard component)
  // ══════════════════════════════════════════════════════════

  const renderAuditLog = () => <AuditDashboard />;

  // ══════════════════════════════════════════════════════════
  // TAB 5: SYSTEM SETTINGS
  // ══════════════════════════════════════════════════════════

  const handleExportFullBackup = async () => {
    setIsExporting(true);
    try {
      // Export full database as JSON
      const backup = {
        _meta: {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          system: 'AMYC Financial Management System',
        },
        users: await db.users.toArray(),
        orgUnits: await db.orgUnits.toArray(),
        categories: await db.categories.toArray(),
        transactions: await db.transactions.toArray(),
        importBatches: await db.importBatches.toArray(),
        notes: await db.notes.toArray(),
        auditLogs: await db.auditLogs.toArray(),
        monthlySubmissions: await db.monthlySubmissions.toArray(),
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `AMYC_FullBackup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (currentUser?.id) {
        await logAudit('export', 'system', 0, currentUser.id, 'Backup kamili imehamishwa');
      }

      toast.success('Backup kamili imehamishwa kikamilifu!', {
        description: `Faili: AMYC_FullBackup_${new Date().toISOString().split('T')[0]}.json`,
        icon: <Download className="h-4 w-4 text-emerald-600" />,
      });
    } catch (error) {
      toast.error('Hitilafu katika kuhamisha backup', {
        description: String(error),
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportFullBackup = async (file: File) => {
    setIsImporting(true);
    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      if (!backup._meta || backup._meta.system !== 'AMYC Financial Management System') {
        toast.error('Faili si sahihi!', {
          description: 'Faili hii si backup ya AMYC Financial System.',
        });
        setIsImporting(false);
        return;
      }

      let importedRecords = 0;

      // Import org units first (needed for references)
      if (backup.orgUnits && Array.isArray(backup.orgUnits)) {
        for (const org of backup.orgUnits) {
          delete org.id; // Let Dexie assign new IDs
          await db.orgUnits.add(org);
          importedRecords++;
        }
      }

      // Import categories
      if (backup.categories && Array.isArray(backup.categories)) {
        for (const cat of backup.categories) {
          delete cat.id;
          await db.categories.add(cat);
          importedRecords++;
        }
      }

      // Import users
      if (backup.users && Array.isArray(backup.users)) {
        for (const user of backup.users) {
          delete user.id;
          await db.users.add(user);
          importedRecords++;
        }
      }

      // Import transactions
      if (backup.transactions && Array.isArray(backup.transactions)) {
        for (const txn of backup.transactions) {
          delete txn.id;
          await db.transactions.add(txn);
          importedRecords++;
        }
      }

      // Import notes
      if (backup.notes && Array.isArray(backup.notes)) {
        for (const note of backup.notes) {
          delete note.id;
          await db.notes.add(note);
          importedRecords++;
        }
      }

      // Import import batches
      if (backup.importBatches && Array.isArray(backup.importBatches)) {
        for (const batch of backup.importBatches) {
          delete batch.id;
          await db.importBatches.add(batch);
          importedRecords++;
        }
      }

      // Import audit logs
      if (backup.auditLogs && Array.isArray(backup.auditLogs)) {
        for (const log of backup.auditLogs) {
          delete log.id;
          await db.auditLogs.add(log);
          importedRecords++;
        }
      }

      // Import monthly submissions
      if (backup.monthlySubmissions && Array.isArray(backup.monthlySubmissions)) {
        for (const sub of backup.monthlySubmissions) {
          delete sub.id;
          await db.monthlySubmissions.add(sub);
          importedRecords++;
        }
      }

      if (currentUser?.id) {
        await logAudit('import', 'system', 0, currentUser.id, `Backup imepakiwa: ${importedRecords} rekodi`);
      }

      toast.success('Backup imepakiwa kikamilifu!', {
        description: `Rekodi ${importedRecords} zimeingizwa kwenye mfumo.`,
        icon: <Upload className="h-4 w-4 text-emerald-600" />,
      });

      await loadAllData();
    } catch (error) {
      toast.error('Hitilafu katika kupakia backup', {
        description: String(error),
      });
    } finally {
      setIsImporting(false);
      if (importFileRef.current) {
        importFileRef.current.value = '';
      }
    }
  };

  const handleClearAllData = async () => {
    setIsClearing(true);
    try {
      await db.transactions.clear();
      await db.notes.clear();
      await db.importBatches.clear();
      await db.auditLogs.clear();
      await db.monthlySubmissions.clear();
      await db.categories.clear();

      if (currentUser?.id) {
        await logAudit('delete', 'system', 0, currentUser.id, 'Data yote imefutwa na msimamizi');
      }

      toast.success('Data yote imefutwa kikamilifu!', {
        description: 'Watumiaji na vitengo vya taasisi havikufutwa.',
        icon: <CheckCircle className="h-4 w-4 text-emerald-600" />,
      });

      await loadAllData();
    } catch (error) {
      toast.error('Hitilafu katika kufuta data', {
        description: String(error),
      });
    } finally {
      setIsClearing(false);
    }
  };

  const renderSystemSettings = () => (
    <div className="space-y-4">
      {/* Export Backup */}
      <Card className="border-emerald-100 dark:border-emerald-900">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                <Download className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Hamisha Backup Kamili</p>
                <p className="text-xs text-muted-foreground">
                  Pakua data yote kama faili ya JSON (backup kamili ya database)
                </p>
              </div>
            </div>
            <Button
              onClick={handleExportFullBackup}
              disabled={isExporting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Hamisha Backup
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Import Backup */}
      <Card className="border-emerald-100 dark:border-emerald-900">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center flex-shrink-0">
                <Upload className="h-5 w-5 text-sky-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-sky-800 dark:text-sky-300">Pakia Backup</p>
                <p className="text-xs text-muted-foreground">
                  Pakia data kutoka faili ya backup ya JSON iliyohamishwa awali
                </p>
              </div>
            </div>
            <div className="shrink-0">
              <input
                ref={importFileRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) handleImportFullBackup(e.target.files[0]);
                }}
              />
              <Button
                onClick={() => importFileRef.current?.click()}
                disabled={isImporting}
                variant="outline"
                className="border-sky-300 text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:text-sky-400 dark:hover:bg-sky-950/30"
              >
                {isImporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Pakia Backup
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Clear All Data */}
      <Card className="border-red-200 dark:border-red-900">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">Futa Data Yote</p>
                <p className="text-xs text-muted-foreground">
                  Futa miamala, kumbukumbu, vikundi, na kumbukumbu za ukaguzi. Watumiaji na vitengo havitafutwa.
                </p>
                <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-1">
                  Onyo: Kitendo hiki hakiwezi kurudishwa!
                </p>
              </div>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  disabled={isClearing}
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30 shrink-0"
                >
                  {isClearing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  Futa Data Yote
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Futa Data Yote?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Kitendo hiki kitaondoa miamala yote, kumbukumbu, vikundi, na kumbukumbu za ukaguzi.
                    Watumiaji na vitengo vya taasisi havitafutwa.
                    Kitendo hiki HAKIWEZI kurudishwa. Una uhakika?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Ghairi</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleClearAllData}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    Ndiyo, Futa Yote
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // MAIN RENDER
  // ══════════════════════════════════════════════════════════

  // Only admin can access
  if (currentUser?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Shield className="h-16 w-16 mb-4 opacity-30" />
        <h2 className="text-xl font-semibold mb-2">Ufikiaji Umezuiwa</h2>
        <p className="text-sm">Paneli ya Msimamizi inapatikana kwa Wamsimamizi tu.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="h-8 w-8 animate-spin text-emerald-600" />
        <span className="ml-3 text-muted-foreground">Inapakia paneli ya msimamizi...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-7 w-7 text-emerald-600" />
            Paneli ya Msimamizi
          </h2>
          <p className="text-muted-foreground mt-1">
            Simamia mfumo, watumiaji, vitengo, na mipangilio
          </p>
        </div>
        <Button
          variant="outline"
          className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          onClick={loadAllData}
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          Oanisha Data
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 h-auto flex-wrap">
          <TabsTrigger
            value="overview"
            className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
          >
            <BarChart3 className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Muhtasari</span>
            <span className="sm:hidden">Muhtasari</span>
          </TabsTrigger>
          <TabsTrigger
            value="users"
            className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
          >
            <Users className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Watumiaji</span>
            <span className="sm:hidden">Watumiaji</span>
          </TabsTrigger>
          <TabsTrigger
            value="orgs"
            className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
          >
            <Building2 className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Vitengo</span>
            <span className="sm:hidden">Vitengo</span>
          </TabsTrigger>
          <TabsTrigger
            value="audit"
            className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
          >
            <ClipboardList className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Ukaguzi</span>
            <span className="sm:hidden">Ukaguzi</span>
          </TabsTrigger>
          <TabsTrigger
            value="settings"
            className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
          >
            <Settings className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Mipangilio</span>
            <span className="sm:hidden">Mipango</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">{renderOverview()}</TabsContent>
        <TabsContent value="users">{renderUserManagement()}</TabsContent>
        <TabsContent value="orgs">{renderOrganizationManagement()}</TabsContent>
        <TabsContent value="audit"><AuditDashboard /></TabsContent>
        <TabsContent value="settings">{renderSystemSettings()}</TabsContent>
      </Tabs>
    </div>
  );
}
