'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/db-offline';
import { useAuthStore } from '@/lib/store';
import type { Note } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  Users,
  Gavel,
  Bell,
  Mail,
  FileText,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Loader2,
  StickyNote,
} from 'lucide-react';

// ============================================================
// Note Type Configuration
// ============================================================

const NOTE_TYPES = [
  { value: 'meeting' as const, label: 'Mkutano', icon: Users, color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 border-emerald-200' },
  { value: 'decision' as const, label: 'Maamuzi', icon: Gavel, color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-amber-200' },
  { value: 'reminder' as const, label: 'Kumbusho', icon: Bell, color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-red-200' },
  { value: 'memo' as const, label: 'Memo', icon: Mail, color: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200 border-sky-200' },
  { value: 'general' as const, label: 'Kawaida', icon: FileText, color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200 border-gray-200' },
];

type NoteTypeValue = typeof NOTE_TYPES[number]['value'];

function getNoteTypeConfig(type: NoteTypeValue) {
  return NOTE_TYPES.find((t) => t.value === type) || NOTE_TYPES[4];
}

// ============================================================
// NotesManager Component
// ============================================================

export default function NotesManager() {
  const { currentOrg, currentUser } = useAuthStore();

  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    type: 'general' as NoteTypeValue,
    content: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  // Load notes for current org
  const [refreshKey, setRefreshKey] = useState(0);

  // Fetch notes when org changes or on refresh
  useEffect(() => {
    if (!currentOrg?.id) return;
    let cancelled = false;
    db.notes
      .where('orgUnitId')
      .equals(currentOrg.id)
      .reverse()
      .sortBy('updatedAt')
      .then((orgNotes) => {
        if (!cancelled) {
          setNotes(orgNotes);
          setIsLoading(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Error loading notes:', error);
          setIsLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [currentOrg?.id, refreshKey]);

  // Filter notes
  const filteredNotes = notes.filter((note) => {
    const matchesSearch =
      !searchQuery ||
      note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || note.type === filterType;
    return matchesSearch && matchesType;
  });

  // Open dialog for new note
  const handleAddNote = () => {
    setEditingNote(null);
    setFormData({ title: '', type: 'general', content: '' });
    setIsDialogOpen(true);
  };

  // Open dialog for editing
  const handleEditNote = (note: Note) => {
    setEditingNote(note);
    setFormData({
      title: note.title,
      type: note.type as NoteTypeValue,
      content: note.content,
    });
    setIsDialogOpen(true);
  };

  // Save note (create or update)
  const handleSaveNote = async () => {
    if (!formData.title.trim() || !formData.content.trim() || !currentOrg?.id || !currentUser?.id) return;

    setIsSaving(true);
    const now = new Date().toISOString();

    try {
      if (editingNote?.id) {
        // Update existing
        await db.notes.update(editingNote.id, {
          title: formData.title.trim(),
          type: formData.type,
          content: formData.content.trim(),
          updatedAt: now,
        });
      } else {
        // Create new
        await db.notes.add({
          title: formData.title.trim(),
          type: formData.type,
          content: formData.content.trim(),
          orgUnitId: currentOrg.id,
          createdBy: currentUser.id,
          createdAt: now,
          updatedAt: now,
        });
      }
      setIsDialogOpen(false);
      setEditingNote(null);
      setFormData({ title: '', type: 'general', content: '' });
      setIsLoading(true);
      setRefreshKey((k) => k + 1);
    } catch (error) {
      console.error('Error saving note:', error);
    }

    setIsSaving(false);
  };

  // Delete note
  const handleDeleteNote = async (noteId: number) => {
    try {
      await db.notes.delete(noteId);
      setIsLoading(true);
      setRefreshKey((k) => k + 1);
    } catch (error) {
      console.error('Error deleting note:', error);
    }
  };

  // Format date
  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('sw-TZ', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
            <StickyNote className="h-5 w-5" />
            Daftari
          </h2>
          <p className="text-sm text-muted-foreground">Vidokezo na kumbukumbu za kitengo</p>
        </div>
        <Button
          onClick={handleAddNote}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Plus className="h-4 w-4 mr-2" />
            Ongeza Kumbukumbu
        </Button>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Tafuta kumbukumbu..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Aina yote" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Aina yote</SelectItem>
            {NOTE_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Notes List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
        </div>
      ) : filteredNotes.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <StickyNote className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              {searchQuery || filterType !== 'all'
                ? 'Hakuna kumbukumbu zinazolingana'
                : 'Hakuna kumbukumbu bado. Bonyeza "Ongeza Kumbukumbu" kuanza.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="max-h-[600px]">
          <div className="grid gap-3">
            {filteredNotes.map((note) => {
              const typeConfig = getNoteTypeConfig(note.type as NoteTypeValue);
              const TypeIcon = typeConfig.icon;

              return (
                <Card
                  key={note.id}
                  className="group hover:border-emerald-300 dark:hover:border-emerald-800 transition-colors"
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className={`shrink-0 rounded-lg p-2 ${typeConfig.color}`}>
                          <TypeIcon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="font-medium text-sm truncate">
                              {note.title}
                            </h3>
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${typeConfig.color}`}
                            >
                              {typeConfig.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2 mb-1.5">
                            {note.content}
                          </p>
                          <p className="text-[10px] text-muted-foreground/70">
                            {formatDate(note.updatedAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                          onClick={() => handleEditNote(note)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Futa Kumbukumbu</AlertDialogTitle>
                              <AlertDialogDescription>
                                Una uhakika unataka kufuta &ldquo;{note.title}&rdquo;? Kitendo hiki hakiwezi kurudishwa.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Ghairi</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => note.id && handleDeleteNote(note.id)}
                                className="bg-red-600 hover:bg-red-700 text-white"
                              >
                                Futa
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* Add/Edit Note Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-emerald-700 dark:text-emerald-400">
              {editingNote ? 'Hariri Kumbukumbu' : 'Ongeza Kumbukumbu'}
            </DialogTitle>
            <DialogDescription>
              {editingNote ? 'Badilisha maelezo ya kumbukumbu' : 'Andika kumbukumbu mpya'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Title */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Kichwa</label>
              <Input
                placeholder="Andika kichwa cha kumbukumbu..."
                value={formData.title}
                onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
              />
            </div>

            {/* Type */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Aina</label>
              <Select
                value={formData.type}
                onValueChange={(val) =>
                  setFormData((prev) => ({ ...prev, type: val as NoteTypeValue }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOTE_TYPES.map((type) => {
                    const Icon = type.icon;
                    return (
                      <SelectItem key={type.value} value={type.value}>
                        <span className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5" />
                          {type.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Content */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Maudhui</label>
              <Textarea
                placeholder="Andika maudhui ya kumbukumbu..."
                value={formData.content}
                onChange={(e) => setFormData((prev) => ({ ...prev, content: e.target.value }))}
                className="min-h-32 resize-y"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isSaving}
            >
              <X className="h-4 w-4 mr-1" />
              Ghairi
            </Button>
            <Button
              onClick={handleSaveNote}
              disabled={!formData.title.trim() || !formData.content.trim() || isSaving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              Hifadhi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
