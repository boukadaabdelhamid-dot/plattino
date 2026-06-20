import React, { useState } from "react";
import { Link } from "wouter";
import { 
  useGetCategories, 
  useCreateCategory, 
  useUpdateCategory, 
  useDeleteCategory,
  getGetCategoriesQueryKey,
  type Category 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/hooks/use-lang";
import { Edit, Trash2, Plus, ArrowLeft } from "lucide-react";

const categorySchema = z.object({
  nameEn: z.string().min(1, "English name is required"),
  nameAr: z.string().min(1, "Arabic name is required"),
  imageUrl: z.string().optional().nullable(),
});

type CategoryFormValues = z.infer<typeof categorySchema>;

export default function AdminCategories() {
  const { toast } = useToast();
  const { lang } = useLang();
  const queryClient = useQueryClient();
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: categories, isLoading } = useGetCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: { nameEn: "", nameAr: "", imageUrl: "" },
  });

  const handleOpenCreate = () => {
    setEditingId(null);
    form.reset({ nameEn: "", nameAr: "", imageUrl: "" });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (category: Category) => {
    setEditingId(category.id);
    form.reset({ 
      nameEn: category.nameEn, 
      nameAr: category.nameAr, 
      imageUrl: category.imageUrl || "" 
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this category?")) {
      deleteCategory.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetCategoriesQueryKey() });
            toast({ title: "Category deleted successfully" });
          },
          onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
        }
      );
    }
  };

  const onSubmit = (values: CategoryFormValues) => {
    if (editingId) {
      updateCategory.mutate(
        { id: editingId, data: values },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetCategoriesQueryKey() });
            toast({ title: "Category updated successfully" });
            setIsDialogOpen(false);
          },
          onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
        }
      );
    } else {
      createCategory.mutate(
        { data: values },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetCategoriesQueryKey() });
            toast({ title: "Category created successfully" });
            setIsDialogOpen(false);
          },
          onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
        }
      );
    }
  };

  const isAr = lang === 'ar';

  return (
    <div className="container mx-auto px-4 py-8" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-4 mb-8 border-b pb-4">
        <Link href="/admin">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-serif font-bold">
            {isAr ? 'إدارة الفئات' : 'Manage Categories'}
          </h1>
        </div>
        <div className="ml-auto">
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleOpenCreate} className="gap-2">
                <Plus className="h-4 w-4" /> {isAr ? 'فئة جديدة' : 'New Category'}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>
                  {editingId
                    ? (isAr ? 'تعديل الفئة' : 'Edit Category')
                    : (isAr ? 'إنشاء فئة' : 'Create Category')}
                </DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                  <FormField
                    control={form.control}
                    name="nameEn"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{isAr ? 'الاسم (إنجليزي)' : 'Name (English)'}</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Fragrances" dir="ltr" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="nameAr"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{isAr ? 'الاسم (عربي)' : 'Name (Arabic)'}</FormLabel>
                        <FormControl>
                          <Input placeholder="مثال: عطور" dir="rtl" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="imageUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{isAr ? 'رابط الصورة (اختياري)' : 'Image URL (Optional)'}</FormLabel>
                        <FormControl>
                          <Input placeholder="https://..." dir="ltr" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full mt-4" disabled={createCategory.isPending || updateCategory.isPending}>
                    {createCategory.isPending || updateCategory.isPending
                      ? (isAr ? 'جاري الحفظ...' : 'Saving...')
                      : (isAr ? 'حفظ' : 'Save')}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">ID</TableHead>
                <TableHead>{isAr ? 'الاسم (إنجليزي)' : 'Name (EN)'}</TableHead>
                <TableHead>{isAr ? 'الاسم (عربي)' : 'Name (AR)'}</TableHead>
                <TableHead className="text-right">{isAr ? 'الإجراءات' : 'Actions'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!categories || categories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    {isAr ? 'لا توجد فئات' : 'No categories found'}
                  </TableCell>
                </TableRow>
              ) : (
                categories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">{category.id}</TableCell>
                    <TableCell>{category.nameEn}</TableCell>
                    <TableCell dir="rtl">{category.nameAr}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(category)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(category.id)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
