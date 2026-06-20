import React, { useState } from "react";
import { Link } from "wouter";
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
  email: z.string().email(),
});

export default function ForgotPassword() {
  const { lang } = useLang();
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const isAr = lang === "ar";

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: z.infer<typeof schema>) {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Request failed");
      }
      setSubmitted(true);
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
            {isAr ? "نسيت كلمة المرور؟" : "Forgot Password?"}
          </h1>
          <p className="text-sm text-muted-foreground mt-2 text-center">
            {isAr
              ? "أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين"
              : "Enter your email and we'll send you a reset link"}
          </p>
        </div>

        {submitted ? (
          <div className="text-center space-y-4">
            <div className="text-green-600 text-4xl">✓</div>
            <p className="text-sm text-muted-foreground">
              {isAr
                ? "إذا كان البريد الإلكتروني مسجلاً لدينا، ستصل إليك تعليمات إعادة تعيين كلمة المرور."
                : "If that email is registered, you'll receive password reset instructions shortly."}
            </p>
            <Link href="/auth/login" className="block text-primary hover:underline text-sm font-semibold">
              {isAr ? "العودة لتسجيل الدخول" : "Back to Login"}
            </Link>
          </div>
        ) : (
          <>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{isAr ? "البريد الإلكتروني" : "Email"}</FormLabel>
                      <FormControl>
                        <Input placeholder="you@example.com" dir="ltr" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full h-12 text-lg font-medium" disabled={loading}>
                  {loading
                    ? (isAr ? "جاري الإرسال..." : "Sending...")
                    : (isAr ? "إرسال رابط الإعادة" : "Send Reset Link")}
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
      </div>
    </div>
  );
}
