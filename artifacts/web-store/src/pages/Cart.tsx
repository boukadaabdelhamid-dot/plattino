import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetCart,
  useUpdateCartItem,
  useRemoveFromCart,
  useValidateCoupon,
  getGetCartQueryKey,
  type CartItem,
  type CouponValidationResponseType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, Minus, Plus, ShoppingBag, ArrowRight, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/hooks/use-lang";
import { useStoreConfig } from "@/hooks/use-store-config";
import { resolveImg } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

export default function Cart() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { lang } = useLang();
  const { acceptOrders, minOrderAmount } = useStoreConfig();
  const queryClient = useQueryClient();
  const [couponCode, setCouponCode] = useState("");
  const [discount, setDiscount] = useState<{ type: CouponValidationResponseType; value: number; code: string } | null>(null);

  const { data: cart, isLoading } = useGetCart();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveFromCart();
  const validateCoupon = useValidateCoupon();

  const handleUpdateQuantity = (productId: number, newQuantity: number) => {
    if (newQuantity < 1) return;
    updateItem.mutate(
      { productId, data: { quantity: newQuantity } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() }),
        onError: (err: Error) => toast({ title: lang === 'ar' ? 'خطأ' : 'Error', description: err.message, variant: "destructive" })
      }
    );
  };

  const handleRemove = (productId: number) => {
    removeItem.mutate(
      { productId },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() }),
        onError: (err: Error) => toast({ title: lang === 'ar' ? 'خطأ' : 'Error', description: err.message, variant: "destructive" })
      }
    );
  };

  const items = (cart ?? []) as CartItem[];
  const subtotal = items.reduce(
    (sum, item) => sum + parseFloat(item.product?.price ?? "0") * item.quantity,
    0
  );
  const discountAmount = discount?.value ?? 0;
  const total = Math.max(0, subtotal - discountAmount);
  const belowMinOrder = minOrderAmount > 0 && total < minOrderAmount && items.length > 0;
  const checkoutBlocked = !acceptOrders || belowMinOrder;

  const handleApplyCoupon = () => {
    if (!couponCode.trim()) return;
    validateCoupon.mutate(
      { data: { code: couponCode, orderTotal: subtotal } },
      {
        onSuccess: (res) => {
          if (res.valid && res.type) {
            setDiscount({ type: res.type, value: parseFloat(res.discount ?? "0"), code: couponCode });
            toast({ title: lang === 'ar' ? "تم تطبيق الكوبون بنجاح" : "Coupon Applied Successfully" });
          } else {
            setDiscount(null);
            toast({ title: lang === 'ar' ? "كوبون غير صالح" : "Invalid Coupon", variant: "destructive" });
          }
        },
        onError: () => toast({ title: lang === 'ar' ? "حدث خطأ" : "Error validating coupon", variant: "destructive" })
      }
    );
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12 md:py-20">
        <Skeleton className="h-12 w-64 mb-12" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-32 text-center flex flex-col items-center">
        <div className="w-32 h-32 bg-muted/30 rounded-full flex items-center justify-center mb-8 border border-border">
          <ShoppingBag className="h-12 w-12 text-muted-foreground opacity-50" />
        </div>
        <h2 className="text-3xl font-serif font-bold mb-4 text-foreground">
          {lang === 'ar' ? 'سلة التسوق فارغة' : 'Your cart is empty'}
        </h2>
        <p className="text-muted-foreground text-lg mb-8 max-w-md mx-auto" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          {lang === 'ar' ? 'لم تقم بإضافة أي منتجات إلى سلة التسوق الخاصة بك بعد. تصفح مجموعتنا الفاخرة.' : "You haven't added any products to your cart yet. Browse our premium collection."}
        </p>
        <Link href="/products">
          <Button size="lg" className="rounded-full px-10 h-14 text-lg">
            {lang === 'ar' ? 'مواصلة التسوق' : 'Continue Shopping'}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 md:py-20">
      {/* Store config banners */}
      {!acceptOrders && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-8 text-sm" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {lang === 'ar' ? 'الطلبات معلقة مؤقتاً. لا يمكن إتمام الشراء في هذا الوقت.' : 'Orders are temporarily suspended. Checkout is unavailable right now.'}
        </div>
      )}
      <h1 className="text-4xl md:text-5xl font-serif font-bold mb-12" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        {lang === 'ar' ? 'سلة التسوق' : 'Shopping Cart'}
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-8 space-y-6">
          <div className="hidden md:grid grid-cols-12 gap-4 pb-4 border-b text-sm font-semibold text-muted-foreground uppercase tracking-wider" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <div className="col-span-6">{lang === 'ar' ? 'المنتج' : 'Product'}</div>
            <div className="col-span-3 text-center">{lang === 'ar' ? 'الكمية' : 'Quantity'}</div>
            <div className="col-span-3 text-right">{lang === 'ar' ? 'المجموع' : 'Total'}</div>
          </div>
          
          <div className="space-y-6 md:space-y-0 md:divide-y">
            {items.map((item: CartItem) => (
              <div key={item.id} className="flex flex-col md:grid md:grid-cols-12 gap-6 items-start md:items-center py-6 bg-card md:bg-transparent border md:border-0 rounded-xl md:rounded-none p-4 md:p-0">
                {/* Product details */}
                <div className="col-span-6 flex gap-4 w-full">
                  <div className="w-24 h-24 bg-muted/20 rounded-lg overflow-hidden shrink-0 border">
                    {item.product?.imageUrl ? (
                      <img src={resolveImg(item.product.imageUrl)} alt={item.product.nameEn} className="w-full h-full object-contain mix-blend-multiply p-2" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No image</div>
                    )}
                  </div>
                  <div className="flex flex-col justify-center flex-1">
                    <Link href={`/products/${item.product?.id}`} className="font-serif font-bold text-lg leading-tight hover:text-primary transition-colors line-clamp-2 mb-1" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                      {lang === 'ar' ? item.product?.nameAr : item.product?.nameEn}
                    </Link>
                    <div className="text-muted-foreground font-medium mb-3">دج {item.product?.price}</div>
                    <button 
                      onClick={() => handleRemove(item.product?.id ?? item.id)}
                      disabled={removeItem.isPending}
                      className="text-sm text-destructive hover:text-destructive/80 font-medium self-start flex items-center gap-1 transition-colors"
                      dir={lang === 'ar' ? 'rtl' : 'ltr'}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {lang === 'ar' ? 'إزالة' : 'Remove'}
                    </button>
                  </div>
                </div>

                {/* Quantity */}
                <div className="col-span-3 flex justify-center w-full md:w-auto">
                  <div className="flex items-center border rounded-full bg-background overflow-hidden p-0.5">
                    <button
                      className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors disabled:opacity-50"
                      onClick={() => handleUpdateQuantity(item.product?.id ?? item.id, item.quantity - 1)}
                      disabled={item.quantity <= 1 || updateItem.isPending}
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-10 text-center font-medium">{item.quantity}</span>
                    <button
                      className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors disabled:opacity-50"
                      onClick={() => handleUpdateQuantity(item.product?.id ?? item.id, item.quantity + 1)}
                      disabled={updateItem.isPending}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                
                {/* Total */}
                <div className="col-span-3 flex justify-between md:justify-end w-full font-bold text-lg text-primary pt-4 border-t md:border-0 md:pt-0">
                  <span className="md:hidden text-muted-foreground">{lang === 'ar' ? 'المجموع:' : 'Total:'}</span>
                  دج {(parseFloat(item.product?.price ?? "0") * item.quantity).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-4">
          <div className="bg-card p-8 rounded-2xl border shadow-sm sticky top-24">
            <h2 className="text-2xl font-serif font-bold mb-6 pb-4 border-b" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              {lang === 'ar' ? 'ملخص الطلب' : 'Order Summary'}
            </h2>

            <div className="space-y-4 text-base mb-8">
              <div className="flex justify-between text-muted-foreground" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                <span>{lang === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}</span>
                <span className="font-medium text-foreground">دج {subtotal.toFixed(2)}</span>
              </div>
              
              {discountAmount > 0 && (
                <div className="flex justify-between text-green-600 font-medium" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                  <span>{lang === 'ar' ? 'الخصم' : 'Discount'} ({discount?.code})</span>
                  <span>- دج {discountAmount.toFixed(2)}</span>
                </div>
              )}
              
              <div className="flex justify-between font-bold text-2xl pt-4 border-t mt-4" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                <span>{lang === 'ar' ? 'الإجمالي' : 'Total'}</span>
                <span className="text-primary">دج {total.toFixed(2)}</span>
              </div>
              <p className="text-xs text-muted-foreground text-center mt-2" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                {lang === 'ar' ? 'شامل ضريبة القيمة المضافة' : 'Includes VAT'}
              </p>

              {belowMinOrder && (
                <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {lang === 'ar'
                    ? `الحد الأدنى للطلب هو دج ${minOrderAmount.toFixed(2)}. يرجى إضافة منتجات أخرى.`
                    : `Minimum order amount is دج ${minOrderAmount.toFixed(2)}. Please add more items.`}
                </div>
              )}
            </div>

            <div className="space-y-3 mb-8">
              <label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground block" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                {lang === 'ar' ? 'كود الخصم' : 'Coupon Code'}
              </label>
              <div className="flex gap-2" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                <Input
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder={lang === 'ar' ? "أدخل الكود" : "Enter code"}
                  className="h-12 bg-background focus-visible:ring-primary"
                />
                <Button
                  variant="secondary"
                  className="h-12 px-6"
                  onClick={handleApplyCoupon}
                  disabled={validateCoupon.isPending || !couponCode}
                >
                  {lang === 'ar' ? 'تطبيق' : 'Apply'}
                </Button>
              </div>
            </div>

            <Button
              className="w-full h-14 text-lg rounded-full shadow-md hover:shadow-lg transition-all"
              onClick={() => setLocation(`/checkout?coupon=${discount?.code || ''}`)}
              disabled={checkoutBlocked}
              data-testid="button-checkout"
            >
              {lang === 'ar' ? 'إتمام الطلب' : 'Checkout'}
              {lang === 'ar' ? <ArrowLeft className="ml-2 h-5 w-5" /> : <ArrowRight className="ml-2 h-5 w-5" />}
            </Button>
            
            <div className="mt-6 text-center">
              <Link href="/products" className="text-sm text-muted-foreground hover:text-primary underline underline-offset-4 transition-colors" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                {lang === 'ar' ? 'أو مواصلة التسوق' : 'or Continue Shopping'}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
