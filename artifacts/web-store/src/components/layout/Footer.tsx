import React from "react";
import { Link } from "wouter";
import { useStoreConfig } from "@/hooks/use-store-config";
import { useLang } from "@/hooks/use-lang";
import { Facebook, Instagram, Mail, Phone, MessageCircle } from "lucide-react";

export function Footer() {
  const { description, facebookUrl, instagramUrl, tiktokUrl, whatsappNumber } = useStoreConfig();
  const { lang } = useLang();

  const hasSocial = facebookUrl || instagramUrl || tiktokUrl || whatsappNumber;
  const year = new Date().getFullYear();

  return (
    <footer className="border-t bg-card mt-auto" dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">

          {/* Brand + description */}
          <div className="space-y-3">
            <p className="font-serif text-xl font-bold text-primary">Midanic ميدانيك</p>
            {description && (
              <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
            )}
          </div>

          {/* Quick links */}
          <div className="space-y-3">
            <h4 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
              {lang === "ar" ? "روابط سريعة" : "Navigation"}
            </h4>
            <nav className="flex flex-col gap-2 text-sm">
              <Link href="/" className="text-muted-foreground hover:text-primary transition-colors">
                {lang === "ar" ? "الرئيسية" : "Home"}
              </Link>
              <Link href="/products" className="text-muted-foreground hover:text-primary transition-colors">
                {lang === "ar" ? "المنتجات" : "Products"}
              </Link>
            </nav>
          </div>

          {/* Contact & Social */}
          <div className="space-y-3">
            <h4 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
              {lang === "ar" ? "تواصل معنا" : "Contact & Social"}
            </h4>
            <div className="flex flex-col gap-2.5">
              {hasSocial && (
                <div className="flex items-center gap-3 flex-wrap">
                  {facebookUrl && (
                    <a href={facebookUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
                      <Facebook className="h-4 w-4" />
                      <span>Facebook</span>
                    </a>
                  )}
                  {instagramUrl && (
                    <a href={instagramUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
                      <Instagram className="h-4 w-4" />
                      <span>Instagram</span>
                    </a>
                  )}
                  {tiktokUrl && (
                    <a href={tiktokUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V9.17a8.16 8.16 0 0 0 4.77 1.52V7.24a4.85 4.85 0 0 1-1-.55z"/>
                      </svg>
                      <span>TikTok</span>
                    </a>
                  )}
                  {whatsappNumber && (
                    <a href={`https://wa.me/${whatsappNumber.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-green-600 transition-colors">
                      <MessageCircle className="h-4 w-4" />
                      <span>WhatsApp</span>
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Copyright */}
        <div className="border-t mt-10 pt-6 text-center text-xs text-muted-foreground space-y-1">
          <p>© {year} Midanic. All rights reserved. · جميع الحقوق محفوظة.</p>
        </div>
      </div>
    </footer>
  );
}
