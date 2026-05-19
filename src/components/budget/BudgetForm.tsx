'use client';

import { useEffect, useState, useCallback } from 'react';
import { db, getCategories } from '@/lib/db-offline';
import { useAuthStore, useFinancialStore } from '@/lib/store';
import { DEPARTMENTS, MONTHS } from '@/lib/types';
import type { Category, Department, OrgLevel, BudgetItem } from '@/lib/types';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  PlusCircle, Trash2, Save, FileSpreadsheet, ChevronDown, ChevronUp,
  Pencil, Copy, CheckCircle2,
} from 'lucide-react';

interface BudgetLineItem {
  tempId: string;
  type: 'income' | 'expense';
  categoryId: number;
  category_name: string;
  department: string;
  month: number | null; // null = annual
  budgetAmount: number;
  description: string;
}

interface BudgetFormProps {
  editingBudgetId?: number | null;
  onSaved?: () => void;
  onCancel?: () => void;
}

export default function BudgetForm({ editingBudgetId, onSaved, onCancel }: BudgetFormProps) {
  const { currentOrg, currentUser } = useAuthStore();
  const { selectedYear } = useFinancialStore();

  const [budgetName, setBudgetName] = useState('');
  const [budgetYear, setBudgetYear] = useState(selectedYear);
  const [budgetDescription, setBudgetDescription] = useState('');
  const [lineItems, setLineItems] = useState<BudgetLineItem[]>([]);
  const [incomeCategories, setIncomeCategories] = useState<Category[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showIncomeItems, setShowIncomeItems] = useState(true);
  const [showExpenseItems, setShowExpenseItems] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addItemType, setAddItemType] = useState<'income' | 'expense'>('income');
  const [addCategoryId, setAddCategoryId] = useState('');
  const [addDepartment, setAddDepartment] = useState('');
  const [addMonth, setAddMonth] = useState<string>('annual');
  const [addAmount, setAddAmount] = useState('');
  const [addDescription, setAddDescription] = useState('');

  // Load categories
  useEffect(() => {
    async function loadCategories() {
      const incCats = await getCategories('income');
      const expCats = await getCategories('expense');
      setIncomeCategories(incCats);
      setExpenseCategories(expCats);
    }
    loadCategories();
  }, []);

  // Load existing budget if editing
  useEffect(() => {
    if (editingBudgetId) {
      loadBudgetForEditing(editingBudgetId);
    }
  }, [editingBudgetId]);

  const loadBudgetForEditing = async (budgetId: number) => {
    try {
      const budget = await db.budgets.get(budgetId);
      if (budget) {
        setBudgetName(budget.name);
        setBudgetYear(budget.year);
        setBudgetDescription(budget.description);

        const items = await db.budgetItems.where('budgetId').equals(budgetId).toArray();
        const lineItems: BudgetLineItem[] = items.map(item => ({
          tempId: `item-${item.id}`,
          type: item.type,
          categoryId: item.categoryId,
          category_name: item.category_name,
          department: item.department,
          month: item.month,
          budgetAmount: item.budgetAmount,
          description: item.description,
        }));
        setLineItems(lineItems);
      }
    } catch (err) {
      console.error('Error loading budget:', err);
      toast.error('Hitilafu katika kupakia bajeti');
    }
  };

  // Set default name when year changes
  useEffect(() => {
    if (!editingBudgetId && !budgetName) {
      setBudgetName(`Bajeti ya Mwaka ${budgetYear}`);
    }
  }, [budgetYear, editingBudgetId]);

  const generateTempId = () => `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const resetBudgetForm = () => {
    setBudgetName('');
    setBudgetYear(selectedYear);
    setBudgetDescription('');
    setLineItems([]);
    setShowIncomeItems(true);
    setShowExpenseItems(true);
    setAddItemType('income');
    setAddCategoryId('');
    setAddDepartment('');
    setAddMonth('annual');
    setAddAmount('');
    setAddDescription('');
    setAddDialogOpen(false);
  };

  const handleAddItem = () => {
    if (!addCategoryId || !addDepartment || !addAmount || Number(addAmount) <= 0) {
      toast.error('Jaza sehemu zote zinazohitajika');
      return;
    }

    const categories = addItemType === 'income' ? incomeCategories : expenseCategories;
    const selectedCat = categories.find(c => c.id === Number(addCategoryId));

    const newItem: BudgetLineItem = {
      tempId: generateTempId(),
      type: addItemType,
      categoryId: Number(addCategoryId),
      category_name: selectedCat?.name || '',
      department: addDepartment,
      month: addMonth === 'annual' ? null : Number(addMonth),
      budgetAmount: Number(addAmount),
      description: addDescription,
    };

    setLineItems(prev => [...prev, newItem]);
    setAddCategoryId('');
    setAddDepartment('');
    setAddMonth('annual');
    setAddAmount('');
    setAddDescription('');
    setAddDialogOpen(false);
    toast.success('Kipengele kimeongezwa');
  };

  const handleRemoveItem = (tempId: string) => {
    setLineItems(prev => prev.filter(item => item.tempId !== tempId));
  };

  const handleUpdateItemAmount = (tempId: string, newAmount: number) => {
    setLineItems(prev =>
      prev.map(item =>
        item.tempId === tempId ? { ...item, budgetAmount: newAmount } : item
      )
    );
  };

  const totalIncomeBudget = lineItems
    .filter(i => i.type === 'income')
    .reduce((sum, i) => sum + i.budgetAmount, 0);

  const totalExpenseBudget = lineItems
    .filter(i => i.type === 'expense')
    .reduce((sum, i) => sum + i.budgetAmount, 0);

  const netBudget = totalIncomeBudget - totalExpenseBudget;

  const handleSubmit = async () => {
    if (!currentOrg || !currentUser) {
      toast.error('Tafadhali ingia kwanza');
      return;
    }
    if (!budgetName.trim()) {
      toast.error('Jina la bajeti linahitajika');
      return;
    }
    if (lineItems.length === 0) {
      toast.error('Ongeza angalau kipengele kimoja cha bajeti');
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();

      if (editingBudgetId) {
        // Update existing budget
        await db.budgets.update(editingBudgetId, {
          name: budgetName,
          year: budgetYear,
          description: budgetDescription,
          totalIncomeBudget,
          totalExpenseBudget,
          status: 'revision',
          updatedAt: now,
        });

        // Delete old items and add new ones
        await db.budgetItems.where('budgetId').equals(editingBudgetId).delete();
        for (const item of lineItems) {
          await db.budgetItems.add({
            budgetId: editingBudgetId,
            type: item.type,
            categoryId: item.categoryId,
            category_name: item.category_name,
            department: item.department as Department,
            month: item.month,
            budgetAmount: item.budgetAmount,
            description: item.description,
            createdAt: now,
            updatedAt: now,
          });
        }
        toast.success('Bajeti imesasishwa kikamilifu!');
      } else {
        // Create new budget
        const budgetId = await db.budgets.add({
          name: budgetName,
          year: budgetYear,
          description: budgetDescription,
          status: 'draft',
          orgUnitId: currentOrg.id!,
          orgLevel: currentOrg.type,
          totalIncomeBudget,
          totalExpenseBudget,
          createdBy: currentUser.id!,
          createdAt: now,
          updatedAt: now,
        });

        // Add budget items
        for (const item of lineItems) {
          await db.budgetItems.add({
            budgetId: budgetId as number,
            type: item.type,
            categoryId: item.categoryId,
            category_name: item.category_name,
            department: item.department as Department,
            month: item.month,
            budgetAmount: item.budgetAmount,
            description: item.description,
            createdAt: now,
            updatedAt: now,
          });
        }
        toast.success('Bajeti imeundwa kikamilifu!');
      }

      resetBudgetForm();
      onSaved?.();
    } catch (err) {
      console.error('Error saving budget:', err);
      toast.error('Hitilafu. Jaribu tena.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('sw-TZ', { style: 'decimal', minimumFractionDigits: 0 }).format(val);

  const incomeItems = lineItems.filter(i => i.type === 'income');
  const expenseItems = lineItems.filter(i => i.type === 'expense');

  return (
    <div className="space-y-6">
      {/* Budget Header Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl text-emerald-700 flex items-center gap-2">
            <FileSpreadsheet className="size-5" />
            {editingBudgetId ? 'Hariri Bajeti' : 'Unda Bajeti Mpya'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Jina la Bajeti</label>
              <Input
                value={budgetName}
                onChange={(e) => setBudgetName(e.target.value)}
                placeholder="Bajeti ya Mwaka..."
                className="border-emerald-200"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Mwaka</label>
              <Select
                value={String(budgetYear)}
                onValueChange={(val) => setBudgetYear(Number(val))}
              >
                <SelectTrigger className="border-emerald-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 15 }, (_, i) => 2026 + i).map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Maelezo</label>
            <Textarea
              value={budgetDescription}
              onChange={(e) => setBudgetDescription(e.target.value)}
              placeholder="Maelezo ya bajeti..."
              className="border-emerald-200 min-h-[60px]"
            />
          </div>
        </CardContent>
      </Card>

      {/* Budget Line Items */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg text-emerald-700">Vipengele vya Bajeti</CardTitle>
            <div className="flex gap-2">
              <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => {
                      setAddItemType('income');
                      setAddCategoryId('');
                      setAddDepartment('');
                      setAddMonth('annual');
                      setAddAmount('');
                      setAddDescription('');
                    }}
                  >
                    <PlusCircle className="size-4 mr-1" />
                    Ongeza Kipengele
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle className="text-emerald-700">Ongeza Kipengele cha Bajeti</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    {/* Type Selection */}
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Aina</label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant={addItemType === 'income' ? 'default' : 'outline'}
                          size="sm"
                          className={addItemType === 'income' ? 'bg-green-600 hover:bg-green-700 text-white' : 'border-green-300 text-green-700'}
                          onClick={() => {
                            setAddItemType('income');
                            setAddCategoryId('');
                          }}
                        >
                          Mapato
                        </Button>
                        <Button
                          type="button"
                          variant={addItemType === 'expense' ? 'default' : 'outline'}
                          size="sm"
                          className={addItemType === 'expense' ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'border-orange-300 text-orange-700'}
                          onClick={() => {
                            setAddItemType('expense');
                            setAddCategoryId('');
                          }}
                        >
                          Matumizi
                        </Button>
                      </div>
                    </div>

                    {/* Category */}
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">
                        {addItemType === 'income' ? 'Chanzo cha Mapato' : 'Aina ya Matumizi'}
                      </label>
                      <Select value={addCategoryId} onValueChange={setAddCategoryId}>
                        <SelectTrigger className={addItemType === 'income' ? 'border-green-200' : 'border-orange-200'}>
                          <SelectValue placeholder="Chagua..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(addItemType === 'income' ? incomeCategories : expenseCategories).map(cat => (
                            <SelectItem key={cat.id} value={String(cat.id)}>
                              {cat.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Department */}
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Idara</label>
                      <Select value={addDepartment} onValueChange={setAddDepartment}>
                        <SelectTrigger className="border-emerald-200">
                          <SelectValue placeholder="Chagua idara" />
                        </SelectTrigger>
                        <SelectContent>
                          {DEPARTMENTS.map(dept => (
                            <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Month or Annual */}
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Kipindi</label>
                      <Select value={addMonth} onValueChange={setAddMonth}>
                        <SelectTrigger className="border-emerald-200">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="annual">Mwaka Nzima</SelectItem>
                          {MONTHS.map((m, i) => (
                            <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Amount */}
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Kiasi (TSh)</label>
                      <Input
                        type="number"
                        min={1}
                        value={addAmount}
                        onChange={(e) => setAddAmount(e.target.value)}
                        placeholder="0"
                        className={addItemType === 'income' ? 'border-green-200' : 'border-orange-200'}
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Maelezo</label>
                      <Input
                        value={addDescription}
                        onChange={(e) => setAddDescription(e.target.value)}
                        placeholder="Maelezo ya kipengele..."
                        className="border-emerald-200"
                      />
                    </div>

                    <Button
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={handleAddItem}
                    >
                      <PlusCircle className="size-4 mr-2" />
                      Ongeza
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {lineItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileSpreadsheet className="size-12 mb-3 opacity-40" />
              <p className="text-lg font-medium">Hakuna vipengele bado</p>
              <p className="text-sm">Bonyeza &quot;Ongeza Kipengele&quot; kuanza</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Income Items */}
              {incomeItems.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowIncomeItems(!showIncomeItems)}
                    className="flex items-center gap-2 mb-2 text-green-700 font-semibold hover:text-green-800"
                  >
                    {showIncomeItems ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    Mapato ({incomeItems.length} vipengele) - TSh {formatCurrency(totalIncomeBudget)}
                  </button>
                  {showIncomeItems && (
                    <div className="rounded-lg border border-green-200 overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-green-50">
                            <TableHead className="text-green-800">Chanzo</TableHead>
                            <TableHead className="text-green-800">Idara</TableHead>
                            <TableHead className="text-green-800">Kipindi</TableHead>
                            <TableHead className="text-green-800 text-right">Kiasi</TableHead>
                            <TableHead className="text-green-800 w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {incomeItems.map(item => (
                            <TableRow key={item.tempId}>
                              <TableCell className="font-medium text-sm">{item.category_name}</TableCell>
                              <TableCell className="text-sm">{item.department}</TableCell>
                              <TableCell className="text-sm">
                                {item.month ? MONTHS[item.month - 1] : 'Mwaka Nzima'}
                              </TableCell>
                              <TableCell className="text-right font-medium text-green-600 text-sm">
                                <Input
                                  type="number"
                                  min={0}
                                  value={item.budgetAmount}
                                  onChange={(e) => handleUpdateItemAmount(item.tempId, Number(e.target.value))}
                                  className="w-28 text-right border-green-200 h-8 text-sm"
                                />
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => handleRemoveItem(item.tempId)}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}

              {/* Expense Items */}
              {expenseItems.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowExpenseItems(!showExpenseItems)}
                    className="flex items-center gap-2 mb-2 text-orange-700 font-semibold hover:text-orange-800"
                  >
                    {showExpenseItems ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    Matumizi ({expenseItems.length} vipengele) - TSh {formatCurrency(totalExpenseBudget)}
                  </button>
                  {showExpenseItems && (
                    <div className="rounded-lg border border-orange-200 overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-orange-50">
                            <TableHead className="text-orange-800">Aina</TableHead>
                            <TableHead className="text-orange-800">Idara</TableHead>
                            <TableHead className="text-orange-800">Kipindi</TableHead>
                            <TableHead className="text-orange-800 text-right">Kiasi</TableHead>
                            <TableHead className="text-orange-800 w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {expenseItems.map(item => (
                            <TableRow key={item.tempId}>
                              <TableCell className="font-medium text-sm">{item.category_name}</TableCell>
                              <TableCell className="text-sm">{item.department}</TableCell>
                              <TableCell className="text-sm">
                                {item.month ? MONTHS[item.month - 1] : 'Mwaka Nzima'}
                              </TableCell>
                              <TableCell className="text-right font-medium text-orange-600 text-sm">
                                <Input
                                  type="number"
                                  min={0}
                                  value={item.budgetAmount}
                                  onChange={(e) => handleUpdateItemAmount(item.tempId, Number(e.target.value))}
                                  className="w-28 text-right border-orange-200 h-8 text-sm"
                                />
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => handleRemoveItem(item.tempId)}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}

              {/* Budget Summary */}
              <Separator />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-lg bg-green-50 border border-green-200">
                  <p className="text-sm font-medium text-green-700">Jumla ya Mapato</p>
                  <p className="text-xl font-bold text-green-600">TSh {formatCurrency(totalIncomeBudget)}</p>
                </div>
                <div className="p-4 rounded-lg bg-orange-50 border border-orange-200">
                  <p className="text-sm font-medium text-orange-700">Jumla ya Matumizi</p>
                  <p className="text-xl font-bold text-orange-600">TSh {formatCurrency(totalExpenseBudget)}</p>
                </div>
                <div className={`p-4 rounded-lg border ${netBudget >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                  <p className={`text-sm font-medium ${netBudget >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    Salio la Bajeti
                  </p>
                  <p className={`text-xl font-bold ${netBudget >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    TSh {formatCurrency(netBudget)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Submit Actions */}
      <div className="flex gap-3 justify-end">
        {onCancel && (
          <Button
            variant="outline"
            onClick={onCancel}
            className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          >
            Ghairi
          </Button>
        )}
        <Button
          className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[160px]"
          onClick={handleSubmit}
          disabled={submitting || lineItems.length === 0}
        >
          {submitting ? (
            'Inahifadhi...'
          ) : (
            <>
              <Save className="size-4 mr-2" />
              {editingBudgetId ? 'Sasisha Bajeti' : 'Hifadhi Bajeti'}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
