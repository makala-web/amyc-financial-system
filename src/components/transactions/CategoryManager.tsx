'use client';

import { useEffect, useState, useCallback } from 'react';
import { db } from '@/lib/db-offline';
import { useAuthStore } from '@/lib/store';
import type { Category, OrgLevel } from '@/lib/types';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  PlusCircle, Pencil, Check, X, Tag, RefreshCw,
} from 'lucide-react';

export default function CategoryManager() {
  const { currentOrg } = useAuthStore();
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeTab, setActiveTab] = useState<'income' | 'expense'>('income');
  const [loading, setLoading] = useState(true);

  // Add category state
  const [newCategoryName, setNewCategoryName] = useState('');
  const [adding, setAdding] = useState(false);

  // Edit category state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      const all = await db.categories.toArray();
      setCategories(all.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      console.error('Error loading categories:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const incomeCategories = categories.filter(c => c.type === 'income');
  const expenseCategories = categories.filter(c => c.type === 'expense');
  const activeCategories = activeTab === 'income' ? incomeCategories : expenseCategories;

  // Add new category
  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;

    // Check for duplicate
    const exists = categories.some(
      c => c.name.toLowerCase() === name.toLowerCase() && c.type === activeTab
    );
    if (exists) {
      toast.error('Kundi hili tayari lipo!');
      return;
    }

    const orgLevel = currentOrg?.type || 'tawi';
    try {
      await db.categories.add({
        name,
        type: activeTab,
        isActive: true,
        isDefault: false,
        orgLevel: orgLevel as OrgLevel,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setNewCategoryName('');
      toast.success('Kundi jipya limeongezwa!');
      loadCategories();
    } catch (err) {
      console.error('Error adding category:', err);
      toast.error('Imeshindwa kuongeza kundi. Jaribu tena.');
    }
  };

  // Toggle active/inactive
  const handleToggle = async (category: Category) => {
    if (!category.id) return;
    try {
      await db.categories.update(category.id, {
        isActive: !category.isActive,
        updatedAt: new Date().toISOString(),
      });
      toast.success(category.isActive ? 'Kundi limelemazwa!' : 'Kundi limewezeshwa!');
      loadCategories();
    } catch (err) {
      console.error('Error toggling category:', err);
      toast.error('Imeshindwa kubadilisha hali.');
    }
  };

  // Start editing
  const startEdit = (category: Category) => {
    setEditingId(category.id!);
    setEditName(category.name);
  };

  // Save edit
  const saveEdit = async (id: number) => {
    const name = editName.trim();
    if (!name) return;
    try {
      await db.categories.update(id, {
        name,
        updatedAt: new Date().toISOString(),
      });
      setEditingId(null);
      setEditName('');
      toast.success('Kundi limehaririwa!');
      loadCategories();
    } catch (err) {
      console.error('Error editing category:', err);
      toast.error('Imeshindwa kuhariri kundi.');
    }
  };

  // Cancel edit
  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="text-xl text-emerald-700 flex items-center gap-2">
            <Tag className="size-5" />
            Usimamizi wa Makundi
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={loadCategories}
            className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          >
            <RefreshCw className="size-4 mr-1" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'income' | 'expense')}>
          <TabsList className="mb-4">
            <TabsTrigger value="income" className="data-[state=active]:bg-green-100 data-[state=active]:text-green-700">
              Makundi ya Mapato ({incomeCategories.length})
            </TabsTrigger>
            <TabsTrigger value="expense" className="data-[state=active]:bg-orange-100 data-[state=active]:text-orange-700">
              Makundi ya Matumizi ({expenseCategories.length})
            </TabsTrigger>
          </TabsList>

          {/* Add Category Form */}
          <div className="flex gap-2 mb-4">
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder={activeTab === 'income' ? 'Jina la kundi la mapato jipya...' : 'Jina la kundi la matumizi jipya...'}
              className={`border-${activeTab === 'income' ? 'emerald' : 'orange'}-200`}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddCategory();
              }}
            />
            <Button
              onClick={handleAddCategory}
              className={`shrink-0 ${
                activeTab === 'income'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-orange-600 hover:bg-orange-700'
              } text-white`}
            >
              <PlusCircle className="size-4 mr-1" />
              Ongeza
            </Button>
          </div>

          <Separator className="mb-4" />

          {/* Category List */}
          <div className="max-h-96 overflow-y-auto space-y-2">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 w-full bg-muted animate-pulse rounded-lg" />
              ))
            ) : activeCategories.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground">
                Hakuna makundi
              </div>
            ) : (
              activeCategories.map(cat => (
                <div
                  key={cat.id}
                  className={`flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors ${
                    cat.isActive
                      ? 'bg-background border-border hover:bg-muted/50'
                      : 'bg-muted/30 border-dashed opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {editingId === cat.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-8 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(cat.id!);
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          autoFocus
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 text-emerald-600"
                          onClick={() => saveEdit(cat.id!)}
                        >
                          <Check className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 text-red-500"
                          onClick={cancelEdit}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <span className="truncate text-sm font-medium">
                          {cat.name}
                        </span>
                        {cat.isDefault && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                            Asili
                          </Badge>
                        )}
                        {!cat.isActive && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-red-100 text-red-600 shrink-0">
                            Lemavu
                          </Badge>
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {editingId !== cat.id && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-emerald-600"
                          onClick={() => startEdit(cat)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Switch
                          checked={cat.isActive}
                          onCheckedChange={() => handleToggle(cat)}
                          className="data-[state=checked]:bg-emerald-600"
                        />
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Summary */}
          <div className="mt-4 pt-3 border-t text-sm text-muted-foreground">
            <div className="flex justify-between">
              <span>Jumla: {activeCategories.length} makundi</span>
              <span>Yaliyowezeshwa: {activeCategories.filter(c => c.isActive).length} | Yaliyolemazwa: {activeCategories.filter(c => !c.isActive).length}</span>
            </div>
          </div>
        </Tabs>
      </CardContent>
    </Card>
  );
}
