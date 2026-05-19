'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import IncomeForm from './IncomeForm';
import TransactionList from './TransactionList';
import CategoryManager from './CategoryManager';
import { PlusCircle, List, Tag } from 'lucide-react';

export default function IncomePage() {
  return (
    <div className="space-y-0">
      <Tabs defaultValue="form" className="w-full">
        <TabsList className="mb-4 bg-emerald-100/60 w-full flex flex-wrap h-auto gap-1">
          <TabsTrigger
            value="form"
            className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white gap-1.5 flex-1 min-w-0"
          >
            <PlusCircle className="size-4 shrink-0" />
            <span className="truncate">Ingiza Mapato</span>
          </TabsTrigger>
          <TabsTrigger
            value="list"
            className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white gap-1.5 flex-1 min-w-0"
          >
            <List className="size-4 shrink-0" />
            <span className="truncate">Orodha ya Mapato</span>
          </TabsTrigger>
          <TabsTrigger
            value="categories"
            className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white gap-1.5 flex-1 min-w-0"
          >
            <Tag className="size-4 shrink-0" />
            <span className="truncate">Makundi</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="form">
          <IncomeForm />
        </TabsContent>

        <TabsContent value="list">
          <TransactionList initialType="income" />
        </TabsContent>

        <TabsContent value="categories">
          <CategoryManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
