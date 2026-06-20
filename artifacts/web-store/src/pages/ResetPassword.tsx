import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLang } from "@/hooks/use-lang";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const logoPath = `${import.meta.env.BASE_URL}midanic-logo.jpg`;
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

const schema = z.object({
  password: z.string().min(6),
  confirm: z.string().min(6),
}).refine((d) => d.password === d.confirm, {
  message: "Passwords do not match",
  path: ["confirm"],
});

interface Props {
  token: string;
}

export default function ResetPassword({ token }: Props) {
  const { lang } = useLang();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<"checking" | "valid" | "invalid">("checking");

  const isAr = lang === "ar";

  useEffect(() => {
    if (!token) {
      setTokenStatus("invalid");
      return;
    }
    fetch(`${API_BASE}/api/auth/reset-password/${token}`)
      .then(async (res) => {
        if (res.ok) {
          setTokenStatus("valid");
        } else {
          setTokenStatus("invalid");
        }
      })
      .catch(() => setTokenStatus("invalid"));
  }, [token]);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });

  async function onSubmit(values: z.infer<typeof schema>) {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: values.password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Request failed");
      }
      setDone(true);
      toast({
        title: isAr ? "تم تغيير كلمة المرور" : "Password reset successful",
      });
      setTimeout(() => setLocation("/auth/login"), 2000);
    } catch (err: unknown) {
      toast({
        title: isAr ? "خطأ" : "Error",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4 bg-muted/10" dir={isAr ? "rtl" : "ltr"}>
      <div className="w-full max-w-md bg-card border border-border/50 rounded-xl p-8 shadow-sm">
        <div className="flex flex-col items-center mb-8">
          <img src={logoPath} alt="Midanic Logo" className="h-16 w-auto mb-6" />
          <h1 className="text-2xl font-serif font-bold text-primary text-center">
            {isAr ? "تعيين كلمة مرور جديدة" : "Set New Password"}
          </h1>
        </div>

        {tokenStatus === "checking" && (
          <div className="text-center text-muted-foreground text-sm py-6">
            {isAr ? "جاري التحقق من الرابط..." : "Verifying link..."}
          </div>
        )}

        {tokenStatus === "invalid" && (
          <div className="text-center space-y-4">
            <div className="text-destructive text-4xl">✕</div>
            <p className="text-sm text-muted-foreground">
              {isAr
                ? "هذا الرابط غير صالح أو منتهي الصلاحية. يرجى طلب رابط جديد."
                : "This reset link is invalid or has expired. Please request a new one."}
            </p>
            <Link href="/auth/forgot-password" className="block text-primary hover:underline text-sm font-semibold">
              {isAr ? "طلب رابط جديد" : "Request a new link"}
            </Link>
          </div>
        )}

        {tokenStatus === "valid" && !done && (
          <>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{isAr ? "كلمة المرور الجديدة" : "New Password"}</FormLabel>
                      <FormControl>
                        <Input type="password" dir="ltr" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirm"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{isAr ? "تأكيد كلمة المرور" : "Confirm Password"}</FormLabel>
                      <FormControl>
                        <Input type="password" dir="ltr" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full h-12 text-lg font-medium" disabled={loading}>
                  {loading
                    ? (isAr ? "جاري الحفظ..." : "Saving...")
                    : (isAr ? "تعيين كلمة المرور" : "Reset Password")}
                </Button>
              </form>
            </Form>

            <div className="mt-6 text-center text-sm text-muted-foreground">
              <Link href="/auth/login" className="text-primary hover:underline font-semibold">
                {isAr ? "العودة لتسجيل الدخول" : "Back to Login"}
              </Link>
            </div>
          </>
        )}

        {done && (
          <div className="text-center space-y-4">
            <div className="text-green-600 text-4xl">✓</div>
            <p className="text-sm text-muted-foreground">
              {isAr
                ? "تم تغيير كلمة المرور بنجاح. جاري تحويلك لصفحة تسجيل الدخول..."
                : "Password changed successfully. Redirecting to login..."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
