import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  useGetCart,
  useCreateOrder,
  getGetCartQueryKey,
  type CartItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/hooks/use-lang";
import { useAuth } from "@/hooks/use-auth";
import { useStoreConfig } from "@/hooks/use-store-config";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { resolveImg } from "@/lib/utils";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

interface UserProfile {
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
}

async function fetchProfile(): Promise<UserProfile | null> {
  const token = localStorage.getItem("midanic_token");
  if (!token) return null;
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function saveProfile(data: Partial<UserProfile>): Promise<void> {
  const token = localStorage.getItem("midanic_token");
  if (!token) return;
  await fetch(`${API_BASE}/api/auth/me`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export default function Checkout() {
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const couponCode = searchParams.get("coupon") || undefined;
  const { toast } = useToast();
  const { lang } = useLang();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { acceptOrders, minOrderAmount } = useStoreConfig();
  const { data: cart } = useGetCart();
  const createOrder = useCreateOrder();
  const profileLoaded = useRef(false);

  const [formData, setFormData] = useState({
    customerName: "",
    customerPhone: "",
    customerAddress: "",
  });

  useEffect(() => {
    if (!user || profileLoaded.current) return;
    profileLoaded.current = true;
    fetchProfile().then((profile) => {
      if (!profile) return;
      setFormData(prev => ({
        customerName: prev.customerName || profile.name || "",
        customerPhone: prev.customerPhone || profile.phone || "",
        customerAddress: prev.customerAddress || profile.address || "",
      }));
    });
  }, [user]);

  const cartItems = (cart ?? []) as CartItem[];

  if (cartItems.length === 0) {
    setLocation("/cart");
    return null;
  }

  const subtotal = cartItems.reduce(
    (sum, item) =>
      sum + parseFloat(item.product?.price ?? "0") * item.quantity,
    0
  );

  const belowMinOrder = minOrderAmount > 0 && subtotal < minOrderAmount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const missingProduct = cartItems.find((item: CartItem) => !item.product?.id);
    if (missingProduct) {
      toast({
        title: lang === "ar" ? "خطأ" : "Error",
        description:
          "One or more cart items are missing product information. Please refresh and try again.",
        variant: "destructive",
      });
      return;
    }

    const items = cartItems.map((item: CartItem) => ({
      productId: item.product!.id as number,
      quantity: item.quantity,
    }));

    createOrder.mutate(
      {
        data: {
          customerName: formData.customerName,
          customerPhone: formData.customerPhone,
          customerAddress: formData.customerAddress,
          couponCode: couponCode || null,
          items,
        },
      },
      {
        onSuccess: (order) => {
          queryClient.setQueryData(getGetCartQueryKey(), []);
          if (user) {
            saveProfile({
              name: formData.customerName,
              phone: formData.customerPhone,
              address: formData.customerAddress,
            });
          }
          toast({
            title:
              lang === "ar"
                ? "تم تقديم الطلب بنجاح!"
                : "Order Placed Successfully!",
          });
          setLocation(`/orders/${order.id}`);
        },
        onError: (err: Error) => {
          toast({
            title: lang === "ar" ? "خطأ" : "Error",
            description: err.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="container mx-auto px-4 py-12 md:py-20">
      <div className="max-w-5xl mx-auto">
        {(!acceptOrders || belowMinOrder) && (
          <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-8 text-sm" dir={lang === "ar" ? "rtl" : "ltr"}>
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {!acceptOrders
              ? (lang === "ar" ? "الطلبات معلقة مؤقتاً. لا يمكن تأكيد الطلب في هذا الوقت." : "Orders are temporarily suspended. You cannot place an order right now.")
              : (lang === "ar"
                  ? `الحد الأدنى للطلب هو دج ${minOrderAmount.toFixed(2)}. يرجى إضافة المزيد من المنتجات.`
                  : `Minimum order is دج ${minOrderAmount.toFixed(2)}. Please add more items to your cart.`)}
          </div>
        )}
        <h1
          className="text-4xl md:text-5xl font-serif font-bold mb-12 text-center"
          dir={lang === "ar" ? "rtl" : "ltr"}
        >
          {lang === "ar" ? "إتمام الطلب" : "Checkout"}
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Left column */}
          <div className="lg:col-span-7 xl:col-span-8 order-2 lg:order-1">
            <div className="bg-card border rounded-2xl p-6 md:p-10 shadow-sm">
              <h2
                className="text-2xl font-serif font-bold mb-8 pb-4 border-b"
                dir={lang === "ar" ? "rtl" : "ltr"}
              >
                {lang === "ar" ? "معلومات التوصيل" : "Shipping Information"}
              </h2>

              <form
                id="checkout-form"
                onSubmit={handleSubmit}
                className="space-y-6"
                dir={lang === "ar" ? "rtl" : "ltr"}
              >
                <div className="space-y-2">
                  <Label htmlFor="customerName" className="text-sm font-semibold">
                    {lang === "ar" ? "الاسم الكامل" : "Full Name"}
                  </Label>
                  <Input
                    id="customerName"
                    required
                    value={formData.customerName}
                    onChange={(e) =>
                      setFormData({ ...formData, customerName: e.target.value })
                    }
                    placeholder={
                      lang === "ar" ? "أدخل اسمك الكامل" : "Your full name"
                    }
                    className="h-12 bg-background"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="customerPhone" className="text-sm font-semibold">
                    {lang === "ar" ? "رقم الهاتف" : "Phone Number"}
                  </Label>
                  <Input
                    id="customerPhone"
                    required
                    value={formData.customerPhone}
                    onChange={(e) =>
                      setFormData({ ...formData, customerPhone: e.target.value })
                    }
                    placeholder="+966 5X XXX XXXX"
                    className="h-12 bg-background text-left"
                    dir="ltr"
                  />
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="customerAddress"
                    className="text-sm font-semibold"
                  >
                    {lang === "ar"
                      ? "عنوان التوصيل التفصيلي"
                      : "Detailed Shipping Address"}
                  </Label>
                  <Textarea
                    id="customerAddress"
                    required
                    rows={4}
                    value={formData.customerAddress}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        customerAddress: e.target.value,
                      })
                    }
                    placeholder={
                      lang === "ar"
                        ? "المدينة، الحي، الشارع، رقم المبنى..."
                        : "City, District, Street, Building..."
                    }
                    className="resize-none bg-background p-4"
                  />
                </div>
              </form>
            </div>
          </div>

          {/* Right column — Order Summary */}
          <div className="lg:col-span-5 xl:col-span-4 order-1 lg:order-2 mb-8 lg:mb-0">
            <div className="bg-muted/10 border rounded-2xl p-6 md:p-8 sticky top-24">
              <h2
                className="text-xl font-serif font-bold mb-6 pb-4 border-b"
                dir={lang === "ar" ? "rtl" : "ltr"}
              >
                {lang === "ar" ? "ملخص الطلب" : "Order Summary"}
              </h2>

              <div
                className="space-y-4 mb-6 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar"
                dir={lang === "ar" ? "rtl" : "ltr"}
              >
                {cartItems.map((item) => (
                  <div key={item.id} className="flex gap-4 items-center">
                    <div className="w-16 h-16 bg-white rounded-md border flex items-center justify-center shrink-0 p-1">
                      {item.product?.imageUrl ? (
                        <img
                          src={resolveImg(item.product.imageUrl)}
                          alt=""
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {lang === "ar"
                          ? item.product?.nameAr
                          : item.product?.nameEn}
                      </p>
                      <p className="text-muted-foreground text-xs mt-1">
                        {item.quantity} x دج {item.product?.price}
                      </p>
                    </div>
                    <div className="font-bold text-sm shrink-0">
                      دج{" "}
                      {(
                        parseFloat(item.product?.price ?? "0") * item.quantity
                      ).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>

              <div
                className="space-y-3 pt-6 border-t text-sm mb-6"
                dir={lang === "ar" ? "rtl" : "ltr"}
              >
                <div className="flex justify-between text-muted-foreground">
                  <span>{lang === "ar" ? "المجموع الفرعي" : "Subtotal"}</span>
                  <span>دج {subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>{lang === "ar" ? "التوصيل" : "Shipping"}</span>
                  <span className="text-green-600 font-medium">
                    {lang === "ar" ? "مجاني" : "Free"}
                  </span>
                </div>
                {couponCode && (
                  <div className="flex justify-between text-green-600">
                    <span>
                      {lang === "ar" ? "كود الخصم المطبق" : "Coupon Applied"}
                    </span>
                    <span className="uppercase text-xs border border-green-200 bg-green-50 px-2 rounded-full py-0.5">
                      {couponCode}
                    </span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-xl pt-4 border-t mt-4 text-primary">
                  <span>{lang === "ar" ? "الإجمالي" : "Total"}</span>
                  <span>دج {subtotal.toFixed(2)}</span>
                </div>
              </div>

              <Button
                type="submit"
                form="checkout-form"
                className="w-full h-14 text-lg rounded-full shadow-md"
                disabled={createOrder.isPending || !acceptOrders || belowMinOrder}
                data-testid="button-place-order"
              >
                {createOrder.isPending ? (
                  lang === "ar" ? "جاري التأكيد..." : "Processing..."
                ) : (
                  <>
                    <ShieldCheck className="mr-2 h-5 w-5" />
                    {lang === "ar" ? "تأكيد الطلب" : "Place Order"}
                  </>
                )}
              </Button>

              <p
                className="text-xs text-center text-muted-foreground mt-4"
                dir={lang === "ar" ? "rtl" : "ltr"}
              >
                {lang === "ar"
                  ? 'بالنقر على "تأكيد الطلب"، فإنك توافق على الشروط والأحكام الخاصة بنا.'
                  : 'By placing your order, you agree to our Terms & Conditions.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
