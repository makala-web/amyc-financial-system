// ============================================================
// AMYC Financial Management System - Type Definitions
// ============================================================

// Organization Level (Ngazi)
export type OrgLevel = 'tawi' | 'jimbo' | 'markaz';

// User Roles
export type UserRole = 'admin' | 'simple' | 'mudir' | 'katibu' | 'mweka_hazina' | 'muhasibu' | 'mkaguzi';

// Transaction Type
export type TransactionType = 'income' | 'expense';

// Security Questions for Password Recovery
export const SECURITY_QUESTIONS = [
  'Jina la mama yako ni nani?',
  'Jina lako la utani ni nani?',
  'Shule ya msingi uliyomaliza ni ipi?',
  'Jina la mji uliozaliwa ni upi?',
  'Jina la kipenzi chako cha kwanza ni nani?',
] as const;

export type SecurityQuestion = typeof SECURITY_QUESTIONS[number];

// Password strength criteria
export const PASSWORD_CRITERIA = {
  minLength: 8,
  requiresUppercase: true,
  requiresLowercase: true,
  requiresNumber: true,
  requiresSpecialChar: true,
} as const;

export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < PASSWORD_CRITERIA.minLength) {
    errors.push(`Nenosiri lazima liwe na herufi ${PASSWORD_CRITERIA.minLength} au zaidi`);
  }
  if (PASSWORD_CRITERIA.requiresUppercase && !/[A-Z]/.test(password)) {
    errors.push('Lazima liwe na angalau herufi kubwa (A-Z)');
  }
  if (PASSWORD_CRITERIA.requiresLowercase && !/[a-z]/.test(password)) {
    errors.push('Lazima liwe na angalau herufi ndogo (a-z)');
  }
  if (PASSWORD_CRITERIA.requiresNumber && !/[0-9]/.test(password)) {
    errors.push('Lazima liwe na angalau namba (0-9)');
  }
  if (PASSWORD_CRITERIA.requiresSpecialChar && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Lazima liwe na angalau herufi maalum (!@#$%...)');
  }
  
  return { valid: errors.length === 0, errors };
}

// Department Names (Idara)
export const DEPARTMENTS = [
  'Daawah',
  'Elimu',
  'Ustawi wa Jamii',
  'Uchumi & Miradi',
  'Habari',
] as const;

export type Department = typeof DEPARTMENTS[number];

// Default Income Categories
export const DEFAULT_INCOME_CATEGORIES = [
  'Ruzuku kutoka Markaz Kuu',
  'Ruzuku kutoka Serikalini',
  'Misaada ya Nje',
  'Misikiti',
  'Shule (Ada & Michango mingine)',
  'Mahad',
  'Vyuo',
  'Vituo',
  'Madrasa',
  'Hospitali',
  'Maduka',
  'Mashamba',
  'Majengo ya Biashara',
  'Magari',
  'Sadaka',
  'Zaka',
  'Wahisani',
  'Michango ya Wanajamii',
  'Mkopo',
  'Maegesho ya Magari',
  'Car Wash',
  'Maji (Visima)',
  'Vyanzo vingine',
] as const;

// Default Expense Categories
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Chakula',
  'Mishahara ya Wafanyakazi',
  'Motisha Mbalimbali',
  'Seminari na Mafunzo',
  'Vifaa vya Kufundishia na Kujifunzia',
  'Gharama za Mihadara/Vikao/Kambi/Makongamano',
  'Vitabu',
  'Uendeshaji wa Mitihani',
  'Gharama za Ujenzi',
  'Ukarabati wa Majengo',
  'Michezo na Mashindano Mbalimbali',
  'Shughuli za Utawala na Ofisi',
  'Gharama za Usafiri',
  'Utoaji wa Misaada',
  'Mikopo',
  'Gharama za Maji',
  'Gharama za Umeme',
  'Kodi za Serikali na Tozo',
  'Samani',
  'Huduma',
  'Vifaa',
  'Matengenezo',
  'Mafuta',
  'Stempu',
  'Ardhi',
  'Vyanzo vingine',
] as const;

// Flag to show "Add Custom Category" option in expense forms
export const ALLOW_CUSTOM_EXPENSE_CATEGORY = true;

// Months
export const MONTHS = [
  'Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni',
  'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba',
] as const;

export const MONTHS_SHORT = [
  'JAN', 'FEB', 'MAC', 'APR', 'MEI', 'JUN',
  'JUL', 'AGT', 'SEP', 'OKT', 'NEV', 'DIS',
] as const;

export type Month = typeof MONTHS[number];

// ============================================================
// Role Configuration
// ============================================================

export const ROLE_CONFIG: Record<UserRole, {
  label: string;
  canEnterData: boolean;
  canViewData: boolean;
  canRegisterSubUnits: boolean;
  canManageUsers: boolean;
  canAccessAdmin: boolean;
  allowedLevels: OrgLevel[];
}> = {
  admin: {
    label: 'Msimamizi',
    canEnterData: true,
    canViewData: true,
    canRegisterSubUnits: true,
    canManageUsers: true,
    canAccessAdmin: true,
    allowedLevels: ['markaz', 'jimbo', 'tawi'],
  },
  simple: {
    label: 'Mtumiaji',
    canEnterData: false,
    canViewData: true,
    canRegisterSubUnits: false,
    canManageUsers: false,
    canAccessAdmin: false,
    allowedLevels: ['tawi'],
  },
  mudir: {
    label: 'Mudir',
    canEnterData: false,
    canViewData: true,
    canRegisterSubUnits: false,
    canManageUsers: false,
    canAccessAdmin: false,
    allowedLevels: ['markaz', 'jimbo', 'tawi'],
  },
  katibu: {
    label: 'Katibu',
    canEnterData: false,
    canViewData: true,
    canRegisterSubUnits: true,
    canManageUsers: false,
    canAccessAdmin: false,
    allowedLevels: ['markaz', 'jimbo'],
  },
  mweka_hazina: {
    label: 'Mweka Hazina',
    canEnterData: true,
    canViewData: true,
    canRegisterSubUnits: false,
    canManageUsers: false,
    canAccessAdmin: false,
    allowedLevels: ['markaz', 'jimbo', 'tawi'],
  },
  muhasibu: {
    label: 'Muhasibu',
    canEnterData: true,
    canViewData: true,
    canRegisterSubUnits: false,
    canManageUsers: false,
    canAccessAdmin: false,
    allowedLevels: ['markaz', 'jimbo', 'tawi'],
  },
  mkaguzi: {
    label: 'Mkaguzi',
    canEnterData: false,
    canViewData: true,
    canRegisterSubUnits: false,
    canManageUsers: false,
    canAccessAdmin: false,
    allowedLevels: ['markaz', 'jimbo', 'tawi'],
  },
};

// ============================================================
// Organization Level Configuration
// ============================================================

export const ORG_LEVEL_CONFIG: Record<OrgLevel, {
  label: string;
  codePrefix: string;
  parentType: OrgLevel | null;
  parentLabel: string;
  childType: OrgLevel | null;
  childLabel: string;
}> = {
  markaz: {
    label: 'Markaz Kuu',
    codePrefix: 'MK',
    parentType: null,
    parentLabel: 'Hakuna (ngazi ya juu)',
    childType: 'jimbo',
    childLabel: 'Jimbo',
  },
  jimbo: {
    label: 'Jimbo',
    codePrefix: 'JM',
    parentType: 'markaz',
    parentLabel: 'Markaz Kuu',
    childType: 'tawi',
    childLabel: 'Tawi',
  },
  tawi: {
    label: 'Tawi',
    codePrefix: 'TW',
    parentType: 'jimbo',
    parentLabel: 'Jimbo',
    childType: null,
    childLabel: 'Hakuna (ngazi ya chini)',
  },
};

// ============================================================
// Database Models
// ============================================================

export interface User {
  id?: number;
  username: string;
  email: string; // used for login
  password: string; // hashed
  fullName: string;
  role: UserRole;
  orgLevel: OrgLevel;
  orgUnitId: number; // reference to organization unit
  securityQuestion: string; // for password recovery
  securityAnswer: string; // hashed answer
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrgUnit {
  id?: number;
  name: string;
  type: OrgLevel;
  parentId: number | null; // null for Markaz Kuu
  code: string; // unique code
  isActive: boolean;
  mudirName?: string; // Jina la Mudir (Director)
  mudirSignature?: string; // Sahihi ya Mudir
  mwekahazinaName?: string; // Jina la Mwekahazina (Treasurer)
  mwekahazinaSignature?: string; // Sahihi ya Mwekahazina
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id?: number;
  name: string;
  type: TransactionType; // income or expense
  isActive: boolean;
  isDefault: boolean; // system default vs user-created
  orgLevel: OrgLevel; // available at which level
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id?: number;
  type: TransactionType;
  amount: number;
  date: string; // ISO date
  month: number; // 1-12
  year: number;
  department: Department;
  categoryId: number;
  category_name: string; // denormalized for reports
  description: string;
  source?: string; // for income
  item?: string; // bidhaa/huduma for expense
  vendor?: string; // for expense
  quantity?: number; // for expense
  unitPrice?: number; // for expense
  unit?: string; // kipimo
  orgUnitId: number;
  orgUnitName: string; // denormalized
  orgLevel: OrgLevel;
  enteredBy: number; // user id
  importBatchId?: number; // if from Excel import
  serverId?: number; // Prisma id after sync (local id stays for reports)
  createdAt: string;
  updatedAt: string;
}

export interface ImportBatch {
  id?: number;
  fileName: string;
  fileHash?: string;
  sourceOrgId: number; // which org uploaded
  targetOrgId: number; // which org is importing
  importType: 'income' | 'expense' | 'both' | 'regional_report_nine' | 'branch_report';
  periodMonth?: number;
  periodYear?: number;
  recordCount: number;
  status: 'pending' | 'processed' | 'error';
  importedBy: number;
  createdAt: string;
}

export interface Note {
  id?: number;
  title: string;
  content: string;
  type: 'meeting' | 'decision' | 'reminder' | 'memo' | 'general';
  orgUnitId: number;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id?: number;
  action: string;
  entity: string;
  entityId: number;
  userId: number;
  details: string;
  createdAt: string;
}

export interface MonthlyBalanceRecord {
  id?: number;
  orgUnitId: number;
  month: number;
  year: number;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  carryForward: number;
  generatedBy?: number;
  generatedAt: string;
  reportType: 'branch' | 'regional' | 'markaz' | 'consolidated_master';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConsolidatedReportRecord {
  id?: number;
  unitId: number;
  reportType: 'regional' | 'markaz' | 'consolidated_master';
  month: number;
  year: number;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
  carryForward: number;
  childCount: number;
  incomeBreakdown: string;
  expenseBreakdown: string;
  dataJson?: string;
  generatedBy?: number;
  generatedAt: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportArchiveRecord {
  id?: number;
  entity: 'generic_excel_import' | 'branch_report' | 'regional_report_nine';
  entityId: number;
  sourceOrgId?: number;
  targetOrgId?: number;
  month: number;
  year: number;
  previousDataJson: string;
  replacementDataJson?: string;
  reason: string;
  archivedBy?: number;
  archivedAt: string;
}

// ============================================================
// Budget Types
// ============================================================

export type BudgetStatus = 'draft' | 'approved' | 'revision' | 'rejected';

export interface Budget {
  id?: number;
  name: string; // e.g., "Bajeti ya Mwaka 2026"
  year: number;
  description: string;
  status: BudgetStatus;
  orgUnitId: number;
  orgLevel: OrgLevel;
  totalIncomeBudget: number; // calculated sum of income items
  totalExpenseBudget: number; // calculated sum of expense items
  createdBy: number;
  approvedBy?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetItem {
  id?: number;
  budgetId: number;
  type: TransactionType; // income or expense
  categoryId: number;
  category_name: string; // denormalized
  department: Department;
  month: number | null; // null = annual, 1-12 = monthly
  budgetAmount: number;
  description: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Report Types
// ============================================================

export type ReportType =
  | 'annual_summary'              // Taarifa ya Mapato na Matumizi kwa Mwaka
  | 'monthly_income'              // fomu ya Mapato kwa Mwezi
  | 'monthly_expense'             // fomu ya Matumizi kwa Mwezi
  | 'departmental_annual'         // fomu ya Mapato na Matumizi (Ki-Idara) kwa Mwaka
  | 'branch_unified'              // Ripoti ya Kila Muanya - Unified branch report (5th report)
  | 'regional_unified'            // Ripoti ya Kila Muanya (Jimbo) - Unified regional report
  | 'markaz_income'               // Markaz only - Mapato ya Markaz
  | 'markaz_expense'              // Markaz only - Matumizi ya Markaz
  | 'markaz_departmental'         // Markaz only - Ki-Idara cha Markaz
  | 'markaz_annual_summary'       // Markaz only - Mapato na Matumizi ya Markaz
  | 'consolidation_income'        // Muunganiko - Mapato (Markaz + Majimbo)
  | 'consolidation_expense'       // Muunganiko - Matumizi (Markaz + Majimbo)
  | 'consolidation_departmental'  // Muunganiko - Ki-Idara (Markaz + Majimbo)
  | 'consolidation_full'          // Muunganiko - Mapato na Matumizi (Markaz + Majimbo)
  | 'consolidation_master';       // Ripoti ya Tisa - mjumuhisho wa ripoti nne za muunganiko

// ============================================================
// Performance Report Types (Ripoti ya Utendaji)
// ============================================================

export interface LeaderInfo {
  position: string;
  name: string;
  phone: string;
}

export interface ActivityItem {
  activity: string;
  area: string;
  date: string;
  participants: number;
  notes: string;
}

export interface AchievementItem {
  achievement: string;
  description: string;
}

export interface ChallengeItem {
  challenge: string;
  impact: string;
}

export interface RecommendationItem {
  recommendation: string;
  action: string;
}

export interface ProjectItem {
  name: string;
  progress: string;
  funding: string;
  status: string;
}

export interface DepartmentReportData {
  activities: ActivityItem[];
  achievements: AchievementItem[];
  challenges: ChallengeItem[];
  recommendations: RecommendationItem[];
  // Uchumi-specific
  projects?: ProjectItem[];
  income?: number;
  expense?: number;
  balance?: number;
  // Habari-specific
  whatsappGroups?: string;
  digitalSystem?: string;
  website?: string;
  socialMedia?: string;
  systemNeeds?: string;
}

export interface GoalItem {
  goal: string;
  timeline: string;
  responsible: string;
}

export interface StrategicPriority {
  priority: string;
  description: string;
}

export interface PerformanceReport {
  id?: number;
  orgUnitId: number;
  orgLevel: OrgLevel;
  period: string;
  title: string;
  dateCreated: string;
  dateUpdated: string;
  createdBy: number;
  authorName: string;
  authorRole: string;
  authorPhone: string;
  authorEmail: string;
  // Section A: Taarifa za Awali
  region: string;
  district: string;
  ward: string;
  street: string;
  // Removed: memberCount, branchCount, mosqueCount, schoolCount
  leaders: LeaderInfo[];
  // Section B: Utangulizi
  introduction: string;
  // Section C: Utendaji wa Idara
  daawah: DepartmentReportData;
  elimu: DepartmentReportData;
  ustawi: DepartmentReportData;
  uchumi: DepartmentReportData;
  habari: DepartmentReportData;
  // Section D: Malengo ya Pamoja
  goals: GoalItem[];
  strategicPriorities: StrategicPriority[];
  // Section E: Hitimisho
  conclusion: string;
  mudirName: string;
  mudirSignature?: string;
  katibuName: string;
  katibuSignature?: string;
  signatureDate: string;
}

// ============================================================
// App State
// ============================================================

export interface AppState {
  currentUser: User | null;
  currentOrg: OrgUnit | null;
  isAuthenticated: boolean;
  activeTab: string;
}
