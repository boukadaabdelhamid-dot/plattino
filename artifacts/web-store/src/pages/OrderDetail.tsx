import React from "react";
import { useRoute, Link } from "wouter";
import { useGetOrder, getGetOrderQueryKey, type OrderDetailItemsItem } from "@workspace/api-client-react";
import { resolveImg } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useLang } from "@/hooks/use-lang";
import { format } from "date-fns";
import { ArrowLeft, ArrowRight, MapPin, Phone, User, ReceiptText } from "lucide-react";

export default function OrderDetail() {
  const [, params] = useRoute("/orders/:id");
  const orderId = Number(params?.id);
  const { lang } = useLang();

  const { data: order, isLoading } = useGetOrder(orderId, {
    query: {
      enabled: !!orderId,
      queryKey: getGetOrderQueryKey(orderId),
      refetchInterval: 15000,
    }
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500/10 text-yellow-700 border-yellow-200';
      case 'processing': return 'bg-blue-500/10 text-blue-700 border-blue-200';
      case 'shipped': return 'bg-purple-500/10 text-purple-700 border-purple-200';
      case 'delivered': return 'bg-green-500/10 text-green-700 border-green-200';
      case 'cancelled': return 'bg-destructive/10 text-destructive border-destructive/20';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusText = (status: string) => {
    if (lang !== 'ar') return status;
    switch (status) {
      case 'pending': return 'قيد الانتظار';
      case 'processing': return 'قيد التجهيز';
      case 'shipped': return 'تم الشحن';
      case 'delivered': return 'تم التوصيل';
      case 'cancelled': return 'ملغي';
      default: return status;
    }
  };

  if (isLoading) return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <Skeleton className="h-8 w-32 mb-8" />
      <Skeleton className="h-40 w-full mb-8 rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
  
  if (!order) return <div className="p-20 text-center text-xl font-serif">Order not found / الطلب غير موجود</div>;

  return (
    <div className="container mx-auto px-4 py-8 md:py-12 max-w-4xl">
      <Link href="/orders" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-primary mb-8 transition-colors" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        {lang === 'ar' ? <ArrowRight className="ml-2 h-4 w-4" /> : <ArrowLeft className="mr-2 h-4 w-4" />}
        {lang === 'ar' ? 'العودة إلى طلباتي' : 'Back to Orders'}
      </Link>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-8" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div>
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground mb-2">
            {lang === 'ar' ? `طلب #${order.id}` : `Order #${order.id}`}
          </h1>
          {order.createdAt && (
            <p className="text-muted-foreground flex items-center gap-2">
              <span className="font-medium text-foreground">{format(new Date(order.createdAt), "MMMM d, yyyy")}</span>
              <span className="text-border">•</span>
              <span>{format(new Date(order.createdAt), "h:mm a")}</span>
            </p>
          )}
        </div>
        <Badge className={`capitalize text-sm px-4 py-1.5 font-semibold border ${getStatusColor(order.status)}`}>
          {getStatusText(order.status)}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="md:col-span-2 bg-card border rounded-2xl overflow-hidden shadow-sm">
          <div className="p-5 bg-muted/20 border-b flex items-center gap-3">
            <ReceiptText className="h-5 w-5 text-primary" />
            <h2 className="font-serif font-bold text-lg" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              {lang === 'ar' ? 'تفاصيل الطلب' : 'Order Details'}
            </h2>
          </div>
          <div className="divide-y border-b">
            {order.items?.map((item: OrderDetailItemsItem, idx: number) => (
              <div key={idx} className="p-5 flex gap-5 items-center" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                <div className="w-20 h-20 bg-muted/20 rounded-lg overflow-hidden shrink-0 border border-border/50 p-2">
                  {item.product?.imageUrl && (
                    <img src={resolveImg(item.product.imageUrl)} alt="" className="w-full h-full object-contain mix-blend-multiply" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-lg line-clamp-1 mb-1">
                    {lang === 'ar' ? item.product?.nameAr : item.product?.nameEn}
                  </div>
                  <div className="text-sm text-muted-foreground font-medium">
                    دج {item.unitPrice} × {item.quantity ?? 0}
                  </div>
                </div>
                <div className="font-bold text-lg text-primary shrink-0 whitespace-nowrap">
                  دج {(parseFloat(item.unitPrice ?? "0") * (item.quantity ?? 0)).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
          <div className="p-6 bg-background space-y-3" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            {order.discountAmount && parseFloat(order.discountAmount) > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>{lang === 'ar' ? 'الخصم' : 'Discount'}</span>
                <span className="text-green-600">- دج {order.discountAmount}</span>
              </div>
            )}
            <div className="flex justify-between items-center font-bold text-xl pt-2">
              <span>{lang === 'ar' ? 'الإجمالي' : 'Total'}</span>
              <span className="text-primary text-2xl">دج {order.totalAmount}</span>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-card border rounded-2xl overflow-hidden shadow-sm">
            <div className="p-5 bg-muted/20 border-b">
              <h2 className="font-serif font-bold text-lg" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                {lang === 'ar' ? 'معلومات العميل' : 'Customer Info'}
              </h2>
            </div>
            <div className="p-6 space-y-5" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              <div className="flex gap-3">
                <User className="h-5 w-5 text-muted-foreground shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{lang === 'ar' ? 'الاسم' : 'Name'}</div>
                  <div className="font-medium">{order.customerName}</div>
                </div>
              </div>
              <div className="flex gap-3">
                <Phone className="h-5 w-5 text-muted-foreground shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{lang === 'ar' ? 'رقم الهاتف' : 'Phone'}</div>
                  <div className="font-medium" dir="ltr">{order.customerPhone}</div>
                </div>
              </div>
              <div className="flex gap-3">
                <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{lang === 'ar' ? 'العنوان' : 'Address'}</div>
                  <div className="font-medium leading-relaxed">{order.customerAddress}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
