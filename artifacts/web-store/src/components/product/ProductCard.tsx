import React from "react";
import { Link } from "wouter";
import { type Product } from "@workspace/api-client-react";
import { useLang } from "@/hooks/use-lang";
import { useStoreConfig } from "@/hooks/use-store-config";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Star } from "lucide-react";
import { useAddToCart, getGetCartQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { resolveImg } from "@/lib/utils";

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const { lang } = useLang();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const addToCart = useAddToCart();
  const { showPrices, showStock, acceptOrders } = useStoreConfig();

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();

    if (!user) {
      toast({
        title: "Login Required",
        description: "Please login to add items to your cart. / يرجى تسجيل الدخول لإضافة منتجات إلى سلة التسوق الخاصة بك.",
        variant: "destructive"
      });
      return;
    }

    addToCart.mutate(
      { data: { productId: product.id, quantity: 1 } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
          toast({
            title: "Added to Cart / تمت الإضافة إلى السلة",
            description: `${lang === 'ar' ? product.nameAr : product.nameEn} added to your cart.`
          });
        },
        onError: (err: Error) => {
          toast({
            title: lang === 'ar' ? 'خطأ' : 'Error',
            description: err.message || (lang === 'ar' ? 'تعذّرت الإضافة إلى السلة' : 'Could not add to cart'),
            variant: "destructive"
          });
        }
      }
    );
  };

  const outOfStock = showStock && product.stock === 0;
  const canOrder = acceptOrders && !outOfStock;

  return (
    <Link href={`/products/${product.id}`} className="group flex flex-col gap-4" data-testid={`card-product-${product.id}`}>
      <div className="relative aspect-[4/5] bg-muted/30 rounded-lg overflow-hidden flex items-center justify-center">
        {(product.primaryImage ?? product.imageUrl) ? (
          <img
            src={resolveImg(product.primaryImage ?? product.imageUrl)}
            alt={product.nameEn}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <span className="text-muted-foreground">No image</span>
        )}

        {/* Stock badge */}
        {showStock && product.stock === 0 && (
          <div className="absolute top-2 left-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full">
            {lang === 'ar' ? 'نفذت الكمية' : 'Out of Stock'}
          </div>
        )}

        {/* Quick Add Overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center p-4">
          <Button
            className="w-full bg-white text-black hover:bg-white/90"
            onClick={handleAddToCart}
            disabled={!canOrder || addToCart.isPending}
            data-testid={`button-quick-add-${product.id}`}
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            {!acceptOrders
              ? (lang === 'ar' ? 'غير متاح' : 'Unavailable')
              : outOfStock
                ? (lang === 'ar' ? 'نفذت الكمية' : 'Out of Stock')
                : (lang === 'ar' ? 'أضف للسلة' : 'Add to Cart')}
          </Button>
        </div>
      </div>

      <div className="flex flex-col flex-1">
        <div className="flex justify-between items-start mb-1">
          <h3 className="font-semibold text-lg line-clamp-1 group-hover:text-primary transition-colors" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            {lang === 'ar' ? product.nameAr : product.nameEn}
          </h3>
        </div>

        <div className="flex items-center gap-1 mb-2 text-sm text-muted-foreground">
          <Star className="h-3 w-3 fill-secondary text-secondary" />
          <span>{Number(product.rating || 0).toFixed(1)}</span>
          <span>({product.reviewCount || 0})</span>
        </div>

        {showPrices && (
          <div className="mt-auto font-bold text-primary">
            دج {product.price}
          </div>
        )}
      </div>
    </Link>
  );
}
