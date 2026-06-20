import React from "react";
import { Link } from "wouter";
import { useGetMyOrders, getGetMyOrdersQueryKey, type Order } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useLang } from "@/hooks/use-lang";
import { format } from "date-fns";
import { Package, ChevronRight, ChevronLeft } from "lucide-react";

export default function Orders() {
  const { lang } = useLang();
  const { data: orders, isLoading } = useGetMyOrders({
    query: { queryKey: getGetMyOrdersQueryKey(), refetchInterval: 30000 }
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

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12 md:py-20 max-w-4xl">
        <Skeleton className="h-12 w-64 mb-10" />
        <div className="space-y-6">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 md:py-20 max-w-4xl">
      <div className="mb-12">
        <h1 className="text-4xl font-serif font-bold text-foreground" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          {lang === 'ar' ? 'طلباتي' : 'My Orders'}
        </h1>
      </div>

      {!orders || orders.length === 0 ? (
        <div className="text-center py-20 bg-muted/10 border border-border/50 rounded-2xl flex flex-col items-center">
          <div className="w-24 h-24 bg-muted/50 rounded-full flex items-center justify-center mb-6">
            <Package className="h-10 w-10 text-muted-foreground opacity-60" />
          </div>
          <p className="text-xl font-serif text-foreground mb-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            {lang === 'ar' ? 'لم تقم بأي طلبات بعد.' : "You haven't placed any orders yet."}
          </p>
          <Link href="/products">
            <Button size="lg" className="rounded-full px-8">
              {lang === 'ar' ? 'ابدأ التسوق' : 'Start Shopping'}
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {orders.map((order: Order) => (
            <Link key={order.id} href={`/orders/${order.id}`} className="block group">
              <div className="bg-card border border-border/60 rounded-xl p-6 sm:p-8 shadow-sm hover:shadow-md hover:border-primary/40 transition-all duration-300">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-primary/5 rounded-full flex items-center justify-center shrink-0">
                      <Package className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <div className="font-bold text-lg mb-1 group-hover:text-primary transition-colors">
                        {lang === 'ar' ? `طلب رقم #${order.id}` : `Order #${order.id}`}
                      </div>
                      <div className="text-sm text-muted-foreground font-medium">
                        {order.createdAt ? format(new Date(order.createdAt), "MMMM d, yyyy") : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-0 pt-4 sm:pt-0">
                    <div className="flex flex-col items-start sm:items-end">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                        {lang === 'ar' ? 'الإجمالي' : 'Total'}
                      </span>
                      <div className="font-bold text-xl text-primary">دج {order.totalAmount}</div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge variant="outline" className={`px-3 py-1 capitalize text-sm border ${getStatusColor(order.status)}`}>
                        {getStatusText(order.status)}
                      </Badge>
                      <div className="hidden sm:flex text-muted-foreground group-hover:text-primary transition-colors group-hover:translate-x-1 duration-300">
                        {lang === 'ar' ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

