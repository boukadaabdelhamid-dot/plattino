import React, { useState, useRef } from "react";
import { Link } from "wouter";
import { 
  useGetProducts, 
  useCreateProduct, 
  useUpdateProduct, 
  useDeleteProduct,
  useGetCategories,
  useUploadImage,
  getGetProductsQueryKey,
  type Product,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { resolveImg } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/hooks/use-lang";
import { Edit, Trash2, Plus, ArrowLeft, Image as ImageIcon, Loader2 } from "lucide-react";

const productSchema = z.object({
  nameEn: z.string().min(1, "English name is required"),
  nameAr: z.string().min(1, "Arabic name is required"),
  descriptionEn: z.string().optional(),
  descriptionAr: z.string().optional(),
  price: z.string().min(1, "Price is required"),
  stock: z.coerce.number().min(0, "Stock cannot be negative"),
  categoryId: z.coerce.number().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
});

type ProductFormValues = z.infer<typeof productSchema>;

export default function AdminProducts() {
  const { toast } = useToast();
  const { lang } = useLang();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { data: productsRes, isLoading } = useGetProducts({ limit: 100 }); // simplified pagination for now
  const { data: categories } = useGetCategories();
  
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const uploadImage = useUploadImage();

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: { 
      nameEn: "", nameAr: "", descriptionEn: "", descriptionAr: "", 
      price: "", stock: 0, categoryId: null, imageUrl: "" 
    },
  });

  const handleOpenCreate = () => {
    setEditingId(null);
    form.reset({ 
      nameEn: "", nameAr: "", descriptionEn: "", descriptionAr: "", 
      price: "", stock: 0, categoryId: null, imageUrl: "" 
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (product: Product) => {
    setEditingId(product.id);
    form.reset({ 
      nameEn: product.nameEn, 
      nameAr: product.nameAr, 
      descriptionEn: product.descriptionEn || "", 
      descriptionAr: product.descriptionAr || "", 
      price: product.price, 
      stock: product.stock, 
      categoryId: product.categoryId || null, 
      imageUrl: product.imageUrl || "" 
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this product?")) {
      deleteProduct.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetProductsQueryKey() });
            toast({ title: "Product deleted successfully" });
          },
          onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
        }
      );
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);

    uploadImage.mutate(
      { data: { file } },
      {
        onSuccess: (uploaded) => {
          form.setValue("imageUrl", uploaded.url);
          toast({ title: "Image uploaded successfully" });
          setIsUploading(false);
        },
        onError: (err: Error) => {
          toast({ title: "Upload failed", description: err.message, variant: "destructive" });
          setIsUploading(false);
        }
      }
    );
  };

  const onSubmit = (values: ProductFormValues) => {
    if (editingId) {
      updateProduct.mutate(
        { id: editingId, data: values },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetProductsQueryKey() });
            toast({ title: "Product updated successfully" });
            setIsDialogOpen(false);
          },
          onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
        }
      );
    } else {
      createProduct.mutate(
        { data: values },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetProductsQueryKey() });
            toast({ title: "Product created successfully" });
            setIsDialogOpen(false);
          },
          onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
        }
      );
    }
  };

  const products = productsRes?.products || [];
  const isAr = lang === 'ar';

  return (
    <div className="container mx-auto px-4 py-8" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-4 mb-8 border-b pb-4">
        <Link href="/admin">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-serif font-bold">
            {isAr ? 'إدارة المنتجات' : 'Manage Products'}
          </h1>
        </div>
        <div className="ml-auto">
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleOpenCreate} className="gap-2">
                <Plus className="h-4 w-4" /> {isAr ? 'منتج جديد' : 'New Product'}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingId
                    ? (isAr ? 'تعديل المنتج' : 'Edit Product')
                    : (isAr ? 'إنشاء منتج' : 'Create Product')}
                </DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="nameEn" render={({ field }) => (
                      <FormItem><FormLabel>{isAr ? 'الاسم (إنجليزي)' : 'Name (English)'}</FormLabel><FormControl><Input dir="ltr" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="nameAr" render={({ field }) => (
                      <FormItem><FormLabel>{isAr ? 'الاسم (عربي)' : 'Name (Arabic)'}</FormLabel><FormControl><Input dir="rtl" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="price" render={({ field }) => (
                      <FormItem><FormLabel>{isAr ? 'السعر (ريال)' : 'السعر (دج)'}</FormLabel><FormControl><Input type="number" step="0.01" dir="ltr" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="stock" render={({ field }) => (
                      <FormItem><FormLabel>{isAr ? 'الكمية' : 'Stock Quantity'}</FormLabel><FormControl><Input type="number" dir="ltr" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>

                  <FormField control={form.control} name="categoryId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{isAr ? 'الفئة' : 'Category'}</FormLabel>
                      <Select 
                        value={field.value ? field.value.toString() : ""} 
                        onValueChange={(val) => field.onChange(val ? parseInt(val) : null)}
                      >
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder={isAr ? 'اختر فئة' : 'Select a category'} /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {categories?.map((cat) => (
                            <SelectItem key={cat.id} value={cat.id.toString()}>
                              {isAr ? cat.nameAr : cat.nameEn}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="descriptionEn" render={({ field }) => (
                      <FormItem><FormLabel>{isAr ? 'الوصف (إنجليزي)' : 'Description (English)'}</FormLabel><FormControl><Textarea rows={3} dir="ltr" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="descriptionAr" render={({ field }) => (
                      <FormItem><FormLabel>{isAr ? 'الوصف (عربي)' : 'Description (Arabic)'}</FormLabel><FormControl><Textarea rows={3} dir="rtl" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>

                  <FormField control={form.control} name="imageUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{isAr ? 'صورة المنتج' : 'Product Image'}</FormLabel>
                      <div className="flex gap-2 items-center">
                        <Input 
                          placeholder={isAr ? 'رابط الصورة أو ارفع ملفاً' : 'Image URL or upload'}
                          dir="ltr"
                          {...field} 
                          value={field.value || ""} 
                        />
                        <Button 
                          type="button" 
                          variant="outline" 
                          size="icon"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isUploading}
                        >
                          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                        </Button>
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          className="hidden" 
                          accept="image/*"
                          onChange={handleImageUpload}
                        />
                      </div>
                      {field.value && (
                        <div className="mt-2 w-24 h-24 bg-muted rounded overflow-hidden border">
                          <img src={resolveImg(field.value)} alt="Preview" className="w-full h-full object-cover" />
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )} />

                  <Button type="submit" className="w-full mt-4" disabled={createProduct.isPending || updateProduct.isPending}>
                    {createProduct.isPending || updateProduct.isPending
                      ? (isAr ? 'جاري الحفظ...' : 'Saving...')
                      : (isAr ? 'حفظ المنتج' : 'Save Product')}
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
        <div className="border rounded-md bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">{isAr ? 'الصورة' : 'Image'}</TableHead>
                <TableHead>{isAr ? 'الاسم' : 'Name'}</TableHead>
                <TableHead>{isAr ? 'السعر' : 'Price'}</TableHead>
                <TableHead>{isAr ? 'المخزون' : 'Stock'}</TableHead>
                <TableHead className="text-right">{isAr ? 'الإجراءات' : 'Actions'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!products || products.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    {isAr ? 'لا توجد منتجات' : 'No products found'}
                  </TableCell>
                </TableRow>
              ) : (
                products.map((product: Product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <div className="w-10 h-10 bg-muted rounded overflow-hidden">
                        {product.imageUrl ? (
                          <img src={resolveImg(product.imageUrl)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon className="w-4 h-4 m-3 text-muted-foreground opacity-50" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {isAr ? product.nameAr : product.nameEn}
                      {product.stock < 5 && (
                        <Badge variant="destructive" className="ml-2 text-[10px] py-0 px-1.5 h-4">
                          {isAr ? 'مخزون منخفض' : 'Low Stock'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>دج {product.price}</TableCell>
                    <TableCell>
                      <span className={product.stock < 5 ? "text-destructive font-bold" : ""}>
                        {product.stock}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(product)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(product.id)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
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
