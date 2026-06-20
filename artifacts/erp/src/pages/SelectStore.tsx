import React from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe, useSelectStore } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useStoreContext } from "@/hooks/use-store";
import { useLang } from "@/hooks/use-lang";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Store as StoreIcon } from "lucide-react";
import logoPath from "@assets/logo_des_13_midanic_1777739613232.jpeg";

export default function SelectStore() {
  const [, setLocation] = useLocation();
  const { token, setToken } = useAuth();
  const { setStores, setCurrentStoreId } = useStoreContext();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const qc = useQueryClient();
  const { data: me, isLoading } = useGetMe({ query: { enabled: !!token } });
  const selectStore = useSelectStore();

  const stores = me?.stores ?? [];

  const choose = (storeId: number) => {
    selectStore.mutate({ data: { storeId } }, {
      onSuccess: (res) => {
        setToken(res.token);
        setCurrentStoreId(res.currentStoreId);
        setStores(stores, res.currentStoreId);
        qc.clear();
        setLocation("/home");
      },
    });
  };

  if (!token) { setLocation("/login"); return null; }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-md">
        <CardHeader className="text-center pb-4">
          <img src={logoPath} alt="Midanic" className="h-14 mx-auto mb-2 rounded" />
          <CardTitle className="text-xl font-bold text-primary">
            {t("Choisir un magasin", "اختر المتجر")}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {me?.name ? `${me.name} · ` : ""}{me?.email}
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-sm text-center text-muted-foreground">…</p>}
          {!isLoading && stores.length === 0 && (
            <p className="text-sm text-center text-muted-foreground">
              {t("Aucun magasin assigné", "لا توجد متاجر معينة")}
            </p>
          )}
          {stores.map((s) => (
            <Button
              key={s.id}
              variant="outline"
              className="w-full justify-start h-auto py-3"
              onClick={() => choose(s.id)}
              disabled={selectStore.isPending}
              data-testid={`btn-select-store-${s.id}`}
            >
              <StoreIcon className="h-4 w-4 mr-3 text-primary shrink-0" />
              <div className="text-left flex-1 min-w-0">
                <div className="font-medium truncate">{lang === "ar" ? s.nameAr : s.nameEn}</div>
              </div>
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
