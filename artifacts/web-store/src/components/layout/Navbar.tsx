import React from "react";
import { Link, useLocation } from "wouter";
import { ShoppingBag, User, Globe, LayoutDashboard } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLang } from "@/hooks/use-lang";
import { useStoreConfig } from "@/hooks/use-store-config";
import { useGetCart, getGetCartQueryKey, type CartItem } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

const fallbackLogo = `${import.meta.env.BASE_URL}midanic-logo.jpg`;

export function Navbar() {
  const { user, logout } = useAuth();
  const { lang, toggleLang } = useLang();
  const { logoUrl, nameAr, nameEn } = useStoreConfig();
  const [, setLocation] = useLocation();

  const { data: cart } = useGetCart({
    query: {
      enabled: !!user,
      queryKey: getGetCartQueryKey(),
    }
  });

  const cartCount = (Array.isArray(cart) ? cart : []).reduce(
    (acc: number, item: CartItem) => acc + (item.quantity || 0),
    0
  );

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between mx-auto px-4 md:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <img src={logoUrl ?? fallbackLogo} alt={nameEn} className="h-8 w-8 object-contain rounded" />
            <span className="font-serif font-bold text-lg tracking-tight text-primary">
              {nameEn} {nameAr}
            </span>
          </Link>
          <nav className="hidden md:flex gap-6">
            <Link href="/products" className="text-sm font-medium transition-colors hover:text-primary">
              Products / المنتجات
            </Link>
            {user?.role === "admin" && (
              <Link href="/admin" className="text-sm font-medium transition-colors hover:text-primary flex items-center gap-1">
                <LayoutDashboard className="h-4 w-4" />
                Admin / الإدارة
              </Link>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <Button variant="ghost" size="icon" onClick={toggleLang} data-testid="button-toggle-lang">
            <Globe className="h-5 w-5" />
            <span className="sr-only">Toggle Language</span>
          </Button>

          <Link href="/cart" className="relative group">
            <Button variant="ghost" size="icon" data-testid="link-cart">
              <ShoppingBag className="h-5 w-5" />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {cartCount}
                </span>
              )}
            </Button>
          </Link>

          {user ? (
            <div className="flex items-center gap-2">
              <Link href="/profile">
                <Button variant="ghost" size="icon" data-testid="link-profile">
                  <User className="h-5 w-5" />
                </Button>
              </Link>
              <Button variant="outline" size="sm" onClick={() => {
                logout();
                setLocation("/");
              }} data-testid="button-logout">
                {lang === 'ar' ? 'خروج' : 'Logout'}
              </Button>
            </div>
          ) : (
            <Link href="/auth/login">
              <Button variant="default" size="sm" data-testid="link-login">
                {lang === 'ar' ? 'تسجيل الدخول' : 'Login'}
              </Button>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
