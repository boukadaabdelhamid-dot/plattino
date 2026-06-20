import React, { useState } from "react";
import { useRoute } from "wouter";
import { 
  useGetProduct, 
  useAddToCart, 
  useCreateReview,
  getGetCartQueryKey,
  getGetProductQueryKey,
  type Review,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useLang } from "@/hooks/use-lang";
import { Star, ShoppingCart, Minus, Plus, ShieldCheck, Truck } from "lucide-react";
import { resolveImg } from "@/lib/utils";

export default function ProductDetail() {
  const [, params] = useRoute("/products/:id");
  const productId = Number(params?.id);
  const { user } = useAuth();
  const { lang } = useLang();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [quantity, setQuantity] = useState(1);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [activeImage, setActiveImage] = useState<string | null>(null);

  const { data: product, isLoading } = useGetProduct(productId, {
    query: {
      enabled: !!productId,
      queryKey: getGetProductQueryKey(productId)
    }
  });

  const addToCart = useAddToCart();
  const createReview = useCreateReview();

  const handleAddToCart = () => {
    if (!user) {
      toast({
        title: "Login Required",
        description: lang === 'ar' ? "يرجى تسجيل الدخول لإضافة منتجات إلى سلة التسوق الخاصة بك." : "Please login to add items to your cart.",
        variant: "destructive"
      });
      return;
    }

    addToCart.mutate(
      { data: { productId, quantity } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
          toast({
            title: lang === 'ar' ? 'تمت الإضافة إلى السلة' : 'Added to Cart',
            description: `${quantity}x ${lang === 'ar' ? product?.nameAr : product?.nameEn} ${lang === 'ar' ? 'تمت إضافتها إلى السلة.' : 'added to your cart.'}`
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

  const handleReviewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast({ title: "Login Required", variant: "destructive" });
      return;
    }
    if (!reviewComment.trim()) return;

    createReview.mutate(
      { id: productId, data: { rating: reviewRating, comment: reviewComment } },
      {
        onSuccess: () => {
          setReviewComment("");
          setReviewRating(5);
          queryClient.invalidateQueries({ queryKey: getGetProductQueryKey(productId) });
          toast({ title: lang === 'ar' ? 'تمت إضافة التقييم' : 'Review Added' });
        },
        onError: (err: Error) => {
          toast({ title: lang === 'ar' ? 'خطأ' : 'Error', description: err.message, variant: "destructive" });
        }
      }
    );
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <Skeleton className="aspect-square w-full rounded-xl" />
          <div className="space-y-6">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-8 w-1/4" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-16 w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) return <div className="text-center py-32 text-xl font-serif text-muted-foreground">Product not found</div>;

  const isOutOfStock = product.stock === 0;

  const gallery = (product.images && product.images.length > 0)
    ? [...product.images].sort((a, b) => a.sortOrder - b.sortOrder).map((im) => im.url)
    : ((product.primaryImage ?? product.imageUrl) ? [product.primaryImage ?? product.imageUrl!] : []);
  const mainImage = activeImage && gallery.includes(activeImage)
    ? activeImage
    : (product.primaryImage ?? product.imageUrl ?? gallery[0] ?? null);

  return (
    <div className="container mx-auto px-4 py-12 md:py-20">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 mb-24">
        {/* Product Gallery */}
        <div className="flex flex-col gap-4">
          <div className="bg-muted/20 rounded-2xl overflow-hidden aspect-square flex items-center justify-center border border-border/40 p-4">
            {mainImage ? (
              <img src={resolveImg(mainImage)} alt={product.nameEn} className="w-full h-full object-contain mix-blend-multiply" />
            ) : (
              <span className="text-muted-foreground">No image</span>
            )}
          </div>
          {gallery.length > 1 && (
            <div className="grid grid-cols-5 gap-3">
              {gallery.map((url, i) => (
                <button
                  key={`${url}-${i}`}
                  type="button"
                  onClick={() => setActiveImage(url)}
                  className={`aspect-square rounded-xl overflow-hidden border-2 bg-muted/20 transition-colors ${
                    url === mainImage ? "border-primary" : "border-border/40 hover:border-primary/50"
                  }`}
                  data-testid={`thumbnail-${i}`}
                >
                  <img src={resolveImg(url)} alt={`${product.nameEn} ${i + 1}`} className="w-full h-full object-contain mix-blend-multiply" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Product Info */}
        <div className="flex flex-col pt-4">
          <h1 className="text-4xl md:text-5xl font-serif font-bold mb-4 text-foreground leading-tight" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            {lang === 'ar' ? product.nameAr : product.nameEn}
          </h1>
          
          <div className="flex items-center gap-4 mb-6">
            <div className="flex items-center gap-1 text-secondary">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className={`h-5 w-5 ${i < Math.round(Number(product.rating || 0)) ? 'fill-current' : 'text-muted-foreground opacity-30'}`} />
              ))}
            </div>
            <span className="text-sm text-muted-foreground underline underline-offset-4 cursor-pointer hover:text-primary transition-colors">
              {product.reviewCount} {lang === 'ar' ? 'تقييمات' : 'Reviews'}
            </span>
          </div>
          
          <div className="text-3xl font-bold mb-8 text-primary">
            دج {product.price}
          </div>

          <div className="mb-10 text-muted-foreground leading-relaxed text-lg" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            {lang === 'ar' ? product.descriptionAr : product.descriptionEn}
          </div>

          <div className="mb-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <div className="flex flex-col gap-2">
                <span className="font-medium text-sm text-muted-foreground uppercase tracking-wider" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                  {lang === 'ar' ? 'الكمية' : 'Quantity'}
                </span>
                <div className="flex items-center border border-border/60 rounded-full bg-background p-1">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-10 w-10 rounded-full hover:bg-muted"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    disabled={quantity <= 1 || isOutOfStock}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="w-12 text-center font-medium text-lg">{quantity}</span>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-10 w-10 rounded-full hover:bg-muted"
                    onClick={() => setQuantity(Math.min(product.stock || 99, quantity + 1))}
                    disabled={quantity >= (product.stock || 99) || isOutOfStock}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              <div className="flex-1 w-full sm:mt-6">
                <Button 
                  size="lg" 
                  className="w-full h-14 text-lg rounded-full shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                  disabled={isOutOfStock || addToCart.isPending}
                  onClick={handleAddToCart}
                  data-testid="button-add-to-cart"
                >
                  <ShoppingCart className="mr-3 h-5 w-5" />
                  {isOutOfStock 
                    ? (lang === 'ar' ? 'نفذت الكمية' : 'Out of Stock') 
                    : (addToCart.isPending 
                        ? (lang === 'ar' ? 'جاري الإضافة...' : 'Adding...') 
                        : (lang === 'ar' ? 'أضف إلى السلة' : 'Add to Cart'))}
                </Button>
              </div>
            </div>
            
            {product.stock !== undefined && (
              <p className={`mt-4 text-sm font-medium ${isOutOfStock ? 'text-destructive' : 'text-green-600'}`} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                {isOutOfStock ? (lang === 'ar' ? 'المنتج غير متوفر حالياً' : 'Currently out of stock') : (lang === 'ar' ? `${product.stock} متوفر في المخزون` : `${product.stock} available in stock`)}
              </p>
            )}
          </div>
          
          <div className="mt-8 pt-8 border-t grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-3 text-muted-foreground">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium">{lang === 'ar' ? 'منتجات أصلية 100%' : '100% Authentic Products'}</span>
            </div>
            <div className="flex items-center gap-3 text-muted-foreground">
              <Truck className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium">{lang === 'ar' ? 'توصيل سريع وموثوق' : 'Fast & Reliable Delivery'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Reviews Section */}
      <div className="border-t border-border/40 pt-16">
        <h2 className="text-3xl font-serif font-bold mb-10 text-center" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          {lang === 'ar' ? 'آراء العملاء' : 'Customer Reviews'}
        </h2>
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Review List */}
          <div className="lg:col-span-7 space-y-8">
            {!product.reviews || product.reviews.length === 0 ? (
              <div className="text-center py-12 bg-muted/10 rounded-xl border border-border/40">
                <p className="text-lg text-muted-foreground font-serif">
                  {lang === 'ar' ? 'لا توجد تقييمات بعد. كن أول من يقيم هذا المنتج!' : 'No reviews yet. Be the first to review this product!'}
                </p>
              </div>
            ) : (
              product.reviews.map((review: Review) => (
                <div key={review.id} className="pb-8 border-b border-border/40 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-lg">{review.userName || (lang === 'ar' ? 'مجهول' : 'Anonymous')}</span>
                    <div className="flex text-secondary">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className={`h-4 w-4 ${i < review.rating ? 'fill-current' : 'text-muted-foreground opacity-30'}`} />
                      ))}
                    </div>
                  </div>
                  <p className="text-muted-foreground leading-relaxed text-lg" dir={lang === 'ar' && /[\u0600-\u06FF]/.test(review.comment ?? '') ? 'rtl' : 'ltr'}>
                    {review.comment}
                  </p>
                </div>
              ))
            )}
          </div>

          {/* Add Review Form */}
          <div className="lg:col-span-5">
            <div className="bg-card p-8 rounded-2xl border border-border/60 shadow-sm sticky top-24">
              <h3 className="text-2xl font-serif font-bold mb-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                {lang === 'ar' ? 'اكتب تقييماً' : 'Write a Review'}
              </h3>
              {user ? (
                <form onSubmit={handleReviewSubmit} className="space-y-6">
                  <div>
                    <label className="block text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                      {lang === 'ar' ? 'التقييم' : 'Rating'}
                    </label>
                    <div className="flex gap-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setReviewRating(i + 1)}
                          className="focus:outline-none transition-transform hover:scale-110"
                        >
                          <Star className={`h-8 w-8 ${i < reviewRating ? 'fill-secondary text-secondary' : 'text-muted-foreground opacity-20'}`} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                      {lang === 'ar' ? 'التعليق' : 'Comment'}
                    </label>
                    <Textarea 
                      required
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      placeholder={lang === 'ar' ? "شاركنا رأيك..." : "Share your thoughts..."}
                      rows={5}
                      className="resize-none text-base p-4"
                      dir={lang === 'ar' ? 'rtl' : 'ltr'}
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full h-12 text-base rounded-full"
                    disabled={createReview.isPending || !reviewComment.trim()}
                    data-testid="button-submit-review"
                  >
                    {createReview.isPending 
                      ? (lang === 'ar' ? 'جاري التقديم...' : 'Submitting...') 
                      : (lang === 'ar' ? 'إرسال التقييم' : 'Submit Review')}
                  </Button>
                </form>
              ) : (
                <div className="text-center py-8">
                  <p className="mb-6 text-muted-foreground" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                    {lang === 'ar' ? 'يرجى تسجيل الدخول لكتابة تقييم.' : 'Please login to write a review.'}
                  </p>
                  <Button 
                    variant="outline" 
                    className="w-full h-12 rounded-full"
                    onClick={() => window.location.href = '/auth/login'}
                  >
                    {lang === 'ar' ? 'تسجيل الدخول' : 'Login'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
