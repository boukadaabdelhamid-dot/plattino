import React, { useState } from "react";
import { Link } from "wouter";
import { 
  useGetAdminOrders, 
  useUpdateOrderStatus,
  getGetAdminOrdersQueryKey,
  type Order,
  type OrderStatus
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/hooks/use-lang";
import { ArrowLeft, Eye } from "lucide-react";
import { format } from "date-fns";

export default function AdminOrders() {
  const { toast } = useToast();
  const { lang } = useLang();
  const queryClient = useQueryClient();
  
  const { data: orders, isLoading } = useGetAdminOrders();
  const updateStatus = useUpdateOrderStatus();

  const handleStatusChange = (id: number, status: OrderStatus) => {
    updateStatus.mutate(
      { id, data: { status } },
      {
        onSuccess: () => {
          // Optimistically update
          queryClient.setQueryData(getGetAdminOrdersQueryKey(), (old: Order[] | undefined) => 
            old ? old.map(o => o.id === id ? { ...o, status } : o) : old
          );
          toast({ title: `Order #${id} status updated to ${status}` });
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
      }
    );
  };

  const getStatusColor = (status: OrderStatus) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20 border-yellow-500/20';
      case 'processing': return 'bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 border-blue-500/20';
      case 'shipped': return 'bg-purple-500/10 text-purple-600 hover:bg-purple-500/20 border-purple-500/20';
      case 'delivered': return 'bg-green-500/10 text-green-600 hover:bg-green-500/20 border-green-500/20';
      case 'cancelled': return 'bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20';
      default: return '';
    }
  };

  const isAr = lang === 'ar';

  const statusLabel = (status: OrderStatus) => {
    if (!isAr) return status;
    const map: Record<OrderStatus, string> = {
      pending: 'قيد الانتظار',
      processing: 'قيد التجهيز',
      shipped: 'تم الشحن',
      delivered: 'تم التوصيل',
      cancelled: 'ملغي',
    };
    return map[status] ?? status;
  };

  return (
    <div className="container mx-auto px-4 py-8" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-4 mb-8 border-b pb-4">
        <Link href="/admin">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-serif font-bold">
            {isAr ? 'إدارة الطلبات' : 'Manage Orders'}
          </h1>
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
                <TableHead className="w-[100px]">{isAr ? 'رقم الطلب' : 'Order ID'}</TableHead>
                <TableHead>{isAr ? 'العميل' : 'Customer'}</TableHead>
                <TableHead>{isAr ? 'التاريخ' : 'Date'}</TableHead>
                <TableHead>{isAr ? 'الإجمالي' : 'Total'}</TableHead>
                <TableHead>{isAr ? 'الحالة الحالية' : 'Current Status'}</TableHead>
                <TableHead className="w-[200px]">{isAr ? 'تحديث الحالة' : 'Update Status'}</TableHead>
                <TableHead className="text-right">{isAr ? 'الإجراءات' : 'Actions'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!orders || orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {isAr ? 'لا توجد طلبات' : 'No orders found'}
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((order: Order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">#{order.id}</TableCell>
                    <TableCell>
                      <div>{order.customerName}</div>
                      <div className="text-xs text-muted-foreground">{order.customerPhone}</div>
                    </TableCell>
                    <TableCell>{order.createdAt ? format(new Date(order.createdAt), "MMM d, yyyy") : "—"}</TableCell>
                    <TableCell className="font-bold text-primary">دج {order.totalAmount}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`capitalize ${getStatusColor(order.status)}`}>
                        {statusLabel(order.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Select
                        defaultValue={order.status}
                        onValueChange={(val) => handleStatusChange(order.id, val as OrderStatus)}
                        disabled={updateStatus.isPending}
                      >
                        <SelectTrigger className="w-[140px] h-8 text-xs">
                          <SelectValue placeholder={isAr ? 'الحالة' : 'Status'} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">{isAr ? 'قيد الانتظار' : 'Pending'}</SelectItem>
                          <SelectItem value="processing">{isAr ? 'قيد التجهيز' : 'Processing'}</SelectItem>
                          <SelectItem value="shipped">{isAr ? 'تم الشحن' : 'Shipped'}</SelectItem>
                          <SelectItem value="delivered">{isAr ? 'تم التوصيل' : 'Delivered'}</SelectItem>
                          <SelectItem value="cancelled">{isAr ? 'ملغي' : 'Cancelled'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/orders/${order.id}`}>
                        <Button variant="ghost" size="icon">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
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
