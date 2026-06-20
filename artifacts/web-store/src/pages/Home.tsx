import React from "react";
import { Link } from "wouter";
import { useGetProducts } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { resolveImg } from "@/lib/utils";
import { ProductCard } from "@/components/product/ProductCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang } from "@/hooks/use-lang";
import { useStoreConfig } from "@/hooks/use-store-config";
import { AlertTriangle } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

type ProductType = { id: number; nameFr: string; nameAr: string; imageUrl: string | null };

export default function Home() {
  const { lang } = useLang();
  const { data: productsRes, isLoading: isLoadingProducts } = useGetProducts({ limit: 8 });
  const { bannerUrl, acceptOrders, featuredProductIds, description } = useStoreConfig();

  const { data: productTypes, isLoading: isLoadingTypes } = useQuery<ProductType[]>({
    queryKey: ["/api/product-types"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/product-types`);
      if (!res.ok) throw new Error("Failed to fetch product types");
      return res.json() as Promise<ProductType[]>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const allProducts = productsRes?.products ?? [];
  const allTypes = productTypes ?? [];

  const sortedProducts = featuredProductIds.length > 0
    ? [
        ...allProducts.filter((p) => featuredProductIds.includes(p.id)),
        ...allProducts.filter((p) => !featuredProductIds.includes(p.id)),
      ]
    : allProducts;

  const heroImage = bannerUrl ||
    "https://images.unsplash.com/photo-1556228578-0d85b1a4d571?q=80&w=2000&auto=format&fit=crop";

  return (
    <div className="flex flex-col min-h-screen">

      {/* Orders suspended banner */}
      {!acceptOrders && (
        <div className="w-full bg-amber-50 border-b border-amber-200 py-3 px-4 flex items-center justify-center gap-2 text-amber-800 text-sm font-medium" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {lang === 'ar'
            ? 'لا يمكن استقبال الطلبات مؤقتاً. يمكنك التصفح والإضافة إلى السلة ولكن لا يمكن تأكيد الطلب في هذا الوقت.'
            : 'Orders are temporarily suspended. You can browse and add to cart, but checkout is unavailable right now.'}
        </div>
      )}

      {/* Hero Section */}
      <section className="relative w-full h-[80vh] min-h-[600px] flex items-center justify-center bg-secondary/30 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent z-10" />
          <div className="absolute inset-0 bg-primary/20 z-10 mix-blend-multiply" />
          <img
            src={heroImage}
            alt="Luxury Beauty"
            className="w-full h-full object-cover object-center"
          />
        </div>
        <div className="container relative z-20 px-4 md:px-6 text-center max-w-4xl mx-auto flex flex-col items-center">
          <Badge variant="outline" className="mb-6 bg-background/50 backdrop-blur border-primary/20 text-primary uppercase tracking-widest text-xs px-4 py-1.5 font-medium">
            {lang === 'ar' ? 'العلامة التجارية الفاخرة' : 'Premium Grooming'}
          </Badge>
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-serif font-bold tracking-tight mb-6 text-foreground drop-shadow-sm">
            {lang === 'ar' ? 'اكتشف أناقتك المميزة' : 'Discover Your Signature Elegance'}
          </h1>
          <p className="mt-4 text-lg md:text-2xl max-w-2xl mx-auto text-muted-foreground">
            {description
              ? description
              : lang === 'ar'
                ? 'مستحضرات التجميل والعناية الفاخرة المصممة لنمط الحياة العصري في الشرق الأوسط.'
                : 'Premium beauty and grooming essentials curated for the modern Middle Eastern lifestyle.'}
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <Link href="/products">
              <Button size="lg" className="text-lg px-10 h-14 rounded-full" data-testid="button-shop-now">
                {lang === 'ar' ? 'تسوق الآن' : 'Shop Now'}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Featured Categories (Product Types) */}
      <section className="py-20 md:py-32 bg-background border-b border-border/40">
        <div className="container px-4 md:px-6 mx-auto">
          <div className="flex flex-col items-center text-center mb-16">
            <h2 className="text-4xl font-serif font-bold tracking-tight">
              {lang === 'ar' ? 'تسوق حسب الفئة' : 'Shop by Category'}
            </h2>
            <div className="w-12 h-1 bg-primary mt-6 rounded-full opacity-60"></div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            {isLoadingTypes ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-full" />
              ))
            ) : (
              allTypes.map((type) => (
                <Link
                  key={type.id}
                  href={`/products?type=${encodeURIComponent(type.nameFr)}`}
                  className="group flex flex-col items-center gap-6"
                  data-testid={`link-type-${type.id}`}
                >
                  <div className="w-36 h-36 md:w-56 md:h-56 rounded-full bg-secondary/30 flex items-center justify-center border border-border group-hover:border-primary/50 group-hover:bg-secondary/50 transition-all duration-500 overflow-hidden relative">
                    {type.imageUrl ? (
                      <img
                        src={resolveImg(type.imageUrl)}
                        alt={lang === 'ar' ? type.nameAr : type.nameFr}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                      />
                    ) : (
                      <span className="text-5xl text-primary font-serif italic opacity-30">
                        {(lang === 'ar' ? type.nameAr : type.nameFr).charAt(0)}
                      </span>
                    )}
                  </div>
                  <div className="text-center">
                    <h3 className="font-serif text-xl group-hover:text-primary transition-colors">
                      {lang === 'ar' ? type.nameAr : type.nameFr}
                    </h3>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="py-20 md:py-32 bg-background">
        <div className="container px-4 md:px-6 mx-auto">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2 className="text-4xl font-serif font-bold tracking-tight">
                {lang === 'ar' ? 'المجموعة المميزة' : 'Featured Collection'}
              </h2>
            </div>
            <Link href="/products">
              <Button variant="link" className="hidden sm:flex text-lg hover:no-underline hover:text-primary/80">
                {lang === 'ar' ? 'عرض الكل' : 'View All'} &rarr;
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {isLoadingProducts ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-4">
                  <Skeleton className="aspect-[4/5] w-full rounded-lg" />
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))
            ) : (
              sortedProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))
            )}
          </div>

          <div className="mt-12 sm:hidden flex justify-center">
            <Link href="/products">
              <Button variant="outline" className="w-full h-12 rounded-full text-lg">
                {lang === 'ar' ? 'عرض الكل' : 'View All'}
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
