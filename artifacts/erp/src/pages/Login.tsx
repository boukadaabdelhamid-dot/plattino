import React, { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLogin, useSelectStore } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useStoreContext } from "@/hooks/use-store";
import { useLang } from "@/hooks/use-lang";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, EyeOff } from "lucide-react";
import logoPath from "@assets/logo_des_13_midanic_1777739613232.jpeg";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
});

type FormData = z.infer<typeof schema>;

export default function Login() {
  const [, setLocation] = useLocation();
  const { setToken } = useAuth();
  const { setStores, setCurrentStoreId, clear } = useStoreContext();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const loginMutation = useLogin();
  const selectStore = useSelectStore();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = (data: FormData) => {
    loginMutation.mutate(
      { data },
      {
        onSuccess: (res) => {
          if (res.user?.role === "customer") {
            setError("email", {
              message: t(
                "Accès non autorisé — compte client. Cet espace est réservé au personnel.",
                "وصول غير مصرّح — حساب عميل. هذه المساحة مخصّصة للموظفين فقط.",
              ),
            });
            return;
          }
          setToken(res.token);
          clear();
          const stores = res.stores ?? [];
          if (res.currentStoreId != null) {
            setStores(stores, res.currentStoreId);
            setLocation("/home");
          } else if (stores.length === 0) {
            setLocation("/home");
          } else if (stores.length === 1) {
            selectStore.mutate(
              { data: { storeId: stores[0].id } },
              {
                onSuccess: (sres) => {
                  setToken(sres.token);
                  setStores(stores, sres.currentStoreId);
                  setLocation("/home");
                },
                onError: () => {
                  setStores(stores, stores[0].id);
                  setLocation("/home");
                },
              }
            );
          } else {
            setStores(stores, null);
            setLocation("/select-store");
          }
        },
        onError: () => {
          setError("email", { message: t("Identifiants invalides", "بيانات غير صحيحة") });
        },
      }
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm shadow-md">
        <CardHeader className="text-center pb-4">
          <img src={logoPath} alt="Midanic" className="h-16 mx-auto mb-3 rounded" />
          <CardTitle className="text-2xl font-bold text-primary">Midanic</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("Email", "البريد الإلكتروني")}</Label>
              <Input
                id="email"
                type="email"
                data-testid="input-email"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t("Mot de passe", "كلمة المرور")}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  data-testid="input-password"
                  className="pr-10"
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground focus:outline-none"
                  tabIndex={-1}
                  aria-label={showPassword ? t("Masquer le mot de passe", "إخفاء كلمة المرور") : t("Afficher le mot de passe", "إظهار كلمة المرور")}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending}
              data-testid="button-login"
            >
              {loginMutation.isPending ? t("Connexion...", "جارٍ الدخول...") : t("Se connecter", "تسجيل الدخول")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
