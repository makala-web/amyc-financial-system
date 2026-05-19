// ============================================================
// AMYC Financial Management System - Database Seeder
// Professional Financial System for Ansaar Muslim Youth Centre
// Seeds the database with default data for initial setup
// ============================================================

import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth/server';
import {
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
} from '@/lib/types';

// ============================================================
// Seed Result
// ============================================================

export interface SeedResult {
  success: boolean;
  message: string;
  details: {
    orgUnitsCreated: number;
    usersCreated: number;
    incomeCategoriesCreated: number;
    expenseCategoriesCreated: number;
    systemSettingsCreated: number;
  };
}

// ============================================================
// Default System Settings
// ============================================================

const DEFAULT_SYSTEM_SETTINGS = [
  {
    key: 'system_name',
    value: 'AMYC Financial Management System',
    type: 'string',
    category: 'general',
  },
  {
    key: 'organization_name',
    value: 'Ansaar Muslim Youth Centre',
    type: 'string',
    category: 'general',
  },
  {
    key: 'organization_short_name',
    value: 'AMYC',
    type: 'string',
    category: 'general',
  },
  {
    key: 'currency',
    value: 'TZS',
    type: 'string',
    category: 'financial',
  },
  {
    key: 'currency_symbol',
    value: 'TSh',
    type: 'string',
    category: 'financial',
  },
  {
    key: 'financial_year_start_month',
    value: '1',
    type: 'number',
    category: 'financial',
  },
  {
    key: 'default_language',
    value: 'sw',
    type: 'string',
    category: 'general',
  },
  {
    key: 'max_login_attempts',
    value: '5',
    type: 'number',
    category: 'security',
  },
  {
    key: 'lockout_duration_minutes',
    value: '15',
    type: 'number',
    category: 'security',
  },
  {
    key: 'session_duration_hours',
    value: '24',
    type: 'number',
    category: 'security',
  },
  {
    key: 'password_min_length',
    value: '8',
    type: 'number',
    category: 'security',
  },
  {
    key: 'require_password_uppercase',
    value: 'true',
    type: 'boolean',
    category: 'security',
  },
  {
    key: 'require_password_number',
    value: 'true',
    type: 'boolean',
    category: 'security',
  },
  {
    key: 'require_password_special',
    value: 'true',
    type: 'boolean',
    category: 'security',
  },
  {
    key: 'allow_offline_mode',
    value: 'true',
    type: 'boolean',
    category: 'general',
  },
  {
    key: 'submission_deadline_day',
    value: '5',
    type: 'number',
    category: 'financial',
  },
  {
    key: 'auto_close_month',
    value: 'false',
    type: 'boolean',
    category: 'financial',
  },
  {
    key: 'backup_reminder_days',
    value: '30',
    type: 'number',
    category: 'notification',
  },
  {
    key: 'version',
    value: '2.1.0',
    type: 'string',
    category: 'general',
  },
  {
    key: 'last_auto_backup',
    value: '',
    type: 'string',
    category: 'general',
  },
  {
    key: 'backup_directory',
    value: 'backups',
    type: 'string',
    category: 'general',
  },
];

// ============================================================
// Main Seed Function
// ============================================================

export async function seedDatabase(): Promise<SeedResult> {
  const details = {
    orgUnitsCreated: 0,
    usersCreated: 0,
    incomeCategoriesCreated: 0,
    expenseCategoriesCreated: 0,
    systemSettingsCreated: 0,
  };

  try {
    // 1. Create default Markaz Kuu org unit
    const existingMarkaz = await db.orgUnit.findFirst({
      where: { code: 'MK-001' },
    });

    let markazId: number;

    if (!existingMarkaz) {
      const markaz = await db.orgUnit.create({
        data: {
          name: 'Markaz Kuu',
          code: 'MK-001',
          type: 'markaz',
          parentId: null,
          isActive: true,
        },
      });
      markazId = markaz.id;
      details.orgUnitsCreated += 1;
    } else {
      markazId = existingMarkaz.id;
    }

    // 2. Create default admin user
    const existingAdmin = await db.user.findUnique({
      where: { email: 'admin@amyc.org' },
    });

    if (!existingAdmin) {
      await db.user.create({
        data: {
          username: 'admin',
          email: 'admin@amyc.org',
          passwordHash: hashPassword('Admin@123'),
          fullName: 'Msimamizi Mkuu',
          role: 'admin',
          orgLevel: 'markaz',
          orgUnitId: markazId,
          securityQuestion: 'Jina la mama yako ni nani?',
          securityAnswerHash: hashPassword('admin'),
          isActive: true,
        },
      });
      details.usersCreated += 1;
    }

    // 3. Create default income categories (for all org levels)
    for (const level of ['tawi', 'jimbo', 'markaz'] as const) {
      for (let i = 0; i < DEFAULT_INCOME_CATEGORIES.length; i++) {
        const catName = DEFAULT_INCOME_CATEGORIES[i];
        const existing = await db.category.findFirst({
          where: {
            name: catName,
            type: 'income',
            orgLevel: level,
          },
        });

        if (!existing) {
          await db.category.create({
            data: {
              name: catName,
              type: 'income',
              orgLevel: level,
              isDefault: true,
              isActive: true,
              sortOrder: i,
            },
          });
          details.incomeCategoriesCreated += 1;
        }
      }
    }

    // 4. Create default expense categories (for all org levels)
    for (const level of ['tawi', 'jimbo', 'markaz'] as const) {
      for (let i = 0; i < DEFAULT_EXPENSE_CATEGORIES.length; i++) {
        const catName = DEFAULT_EXPENSE_CATEGORIES[i];
        const existing = await db.category.findFirst({
          where: {
            name: catName,
            type: 'expense',
            orgLevel: level,
          },
        });

        if (!existing) {
          await db.category.create({
            data: {
              name: catName,
              type: 'expense',
              orgLevel: level,
              isDefault: true,
              isActive: true,
              sortOrder: i,
            },
          });
          details.expenseCategoriesCreated += 1;
        }
      }
    }

    // 5. Create default system settings
    for (const setting of DEFAULT_SYSTEM_SETTINGS) {
      const existing = await db.systemSetting.findUnique({
        where: { key: setting.key },
      });

      if (!existing) {
        await db.systemSetting.create({
          data: {
            key: setting.key,
            value: setting.value,
            type: setting.type,
            category: setting.category,
          },
        });
        details.systemSettingsCreated += 1;
      }
    }

    return {
      success: true,
      message: 'Database seeded successfully',
      details,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `Seeding failed: ${errorMessage}`,
      details,
    };
  }
}
