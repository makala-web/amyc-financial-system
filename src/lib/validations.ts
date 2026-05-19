// ============================================================
// AMYC Financial Management System - Zod Validation Schemas
// Comprehensive input validation for all API endpoints
// Prevents malformed data from entering the financial system
// ============================================================

import { z } from 'zod';

// ============================================================
// Common Reusable Validations
// ============================================================

export const positiveAmount = z
  .number()
  .positive('Kiasi lazima kiwe chanya')
  .max(999999999999.99, 'Kiasi ni kubwa mno');

export const monthSchema = z.number().int().min(1).max(12);

export const yearSchema = z.number().int().min(2026).max(2040);

export const safeString = z.string().trim().min(1).max(500);

export const safeStringOptional = z
  .string()
  .trim()
  .max(500)
  .optional()
  .or(z.literal(''));

export const emailSchema = z
  .string()
  .email('Barua pepe si sahihi')
  .toLowerCase()
  .trim();

export const passwordSchema = z
  .string()
  .min(8, 'Nenosiri lazima liwe na herufi 8 au zaidi')
  .regex(/[A-Z]/, 'Lazima liwe na angalau herufi kubwa (A-Z)')
  .regex(/[a-z]/, 'Lazima liwe na angalau herufi ndogo (a-z)')
  .regex(/[0-9]/, 'Lazima liwe na angalau namba (0-9)')
  .regex(
    /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/,
    'Lazima liwe na angalau herufi maalum'
  );

// ============================================================
// Transaction Schemas
// ============================================================

export const createTransactionSchema = z.object({
  type: z.enum(['income', 'expense']),
  amount: positiveAmount,
  date: z.string().min(1, 'Tarehe ni lazima'),
  month: monthSchema,
  year: yearSchema,
  department: z.enum([
    'Daawah',
    'Elimu',
    'Ustawi wa Jamii',
    'Uchumi & Miradi',
    'Habari',
  ]),
  categoryId: z.number().int().positive(),
  description: safeStringOptional,
  source: safeStringOptional,
  vendor: safeStringOptional,
  quantity: z.number().positive().optional().nullable(),
  unitPrice: z.number().positive().optional().nullable(),
  unit: safeStringOptional,
  orgUnitId: z.number().int().positive(),
  importBatchId: z.number().int().positive().optional().nullable(),
  isOpening: z.boolean().optional().default(false),
});

export const updateTransactionSchema = createTransactionSchema
  .partial()
  .extend({
    id: z.number().int().positive(),
  });

// ============================================================
// Submission Schemas
// ============================================================

export const createSubmissionSchema = z.object({
  orgUnitId: z.number().int().positive(),
  month: monthSchema,
  year: yearSchema,
  notes: safeStringOptional,
  isConsolidated: z.boolean().optional().default(false),
  childDataJson: z.string().optional().nullable(),
});

// ============================================================
// Approval Schemas
// ============================================================

export const approvalActionSchema = z.object({
  entityType: z.enum(['transaction', 'submission', 'budget']),
  entityId: z.number().int().positive(),
  action: z.enum(['review', 'approve', 'reject']),
  notes: safeStringOptional,
  rejectionReason: safeStringOptional,
});

// ============================================================
// User Schemas
// ============================================================

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Jina la mtumiaji lazima liwe na herufi 3 au zaidi')
    .max(50),
  email: emailSchema,
  password: passwordSchema,
  fullName: z
    .string()
    .trim()
    .min(2, 'Jina kamili ni lazima')
    .max(150),
  role: z.enum([
    'admin',
    'simple',
    'muhasibu',
    'mweka_hazina',
    'mudir',
    'katibu',
    'mkaguzi',
  ]),
  orgLevel: z.enum(['tawi', 'jimbo', 'markaz']),
  orgUnitId: z.number().int().positive(),
  securityQuestion: z.string().min(1, 'Swali la usalama ni lazima'),
  securityAnswer: z.string().min(1, 'Jibu la swali la usalama ni lazima'),
});

export const updateUserSchema = createUserSchema.partial().extend({
  id: z.number().int().positive(),
  isActive: z.boolean().optional(),
});

// ============================================================
// Organization Schemas
// ============================================================

export const createOrgUnitSchema = z.object({
  name: z.string().trim().min(2, 'Jina ni lazima').max(150),
  code: z
    .string()
    .trim()
    .min(2, 'Kodi ni lazima')
    .max(20)
    .regex(/^[A-Z]{2}\d+$/, 'Kodi lazima iwe kama MK1, JM1, TW1'),
  type: z.enum(['tawi', 'jimbo', 'markaz']),
  parentId: z.number().int().positive().optional().nullable(),
});

// ============================================================
// Category Schemas
// ============================================================

export const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'Jina la kundi ni lazima').max(150),
  type: z.enum(['income', 'expense']),
  orgLevel: z.enum(['tawi', 'jimbo', 'markaz']),
  orgUnitId: z.number().int().positive().optional().nullable(),
  isDefault: z.boolean().optional().default(false),
  sortOrder: z.number().int().optional().default(0),
});

// ============================================================
// Note Schemas
// ============================================================

export const createNoteSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, 'Kichwa cha habari ni lazima')
    .max(200),
  content: z.string().trim().min(1, 'Maudhui ni lazima').max(5000),
  type: z.enum(['meeting', 'decision', 'reminder', 'memo', 'general']),
  priority: z
    .enum(['low', 'normal', 'high', 'urgent'])
    .optional()
    .default('normal'),
  orgUnitId: z.number().int().positive(),
});

// ============================================================
// Budget Schemas
// ============================================================

export const createBudgetSchema = z.object({
  orgUnitId: z.number().int().positive(),
  year: yearSchema,
  department: z.string().trim().min(1),
  category: z.string().trim().min(1),
  type: z.enum(['income', 'expense']),
  plannedAmount: positiveAmount,
  notes: safeStringOptional,
});

// ============================================================
// Authentication Schemas
// ============================================================

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Nenosiri ni lazima'),
});

export const passwordResetSchema = z.object({
  email: emailSchema,
  securityAnswer: z.string().min(1, 'Jibu la swali la usalama ni lazima'),
  newPassword: passwordSchema,
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Nenosiri la sasa ni lazima'),
  newPassword: passwordSchema,
});

// ============================================================
// Excel Import Validation
// ============================================================

export const excelImportSchema = z.object({
  sourceOrgId: z.number().int().positive(),
  targetOrgId: z.number().int().positive(),
  importType: z.enum(['income', 'expense', 'both']),
  month: monthSchema,
  year: yearSchema,
});

// ============================================================
// Type Exports
// ============================================================

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;
export type ApprovalActionInput = z.infer<typeof approvalActionSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateOrgUnitInput = z.infer<typeof createOrgUnitSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
export type ExcelImportInput = z.infer<typeof excelImportSchema>;
