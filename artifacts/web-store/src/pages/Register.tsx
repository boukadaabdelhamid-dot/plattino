import React from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRegister } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
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

const logoPath = `${import.meta.env.BASE_URL}midanic-logo.jpg`;

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  preferredLang: z.enum(["en", "ar"]).default("en"),
});

export default function Register() {
  const [, setLocation] = useLocation();
  const { setToken } = useAuth();
  const { toast } = useToast();
  const { lang } = useLang();
  const registerMutation = useRegister();

  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", preferredLang: "en" },
  });

  function onSubmit(values: z.infer<typeof registerSchema>) {
    registerMutation.mutate(
      { data: values },
      {
        onSuccess: (data) => {
          setToken(data.token);
          toast({ title: "Account created! / تم إنشاء الحساب!" });
          setLocation("/");
        },
        onError: (error: Error) => {
          toast({
            title: "Registration failed / فشل التسجيل",
            description: error.message,
            variant: "destructive",
          });
        },
      }
    );
  }

  const isAr = lang === 'ar';

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4 bg-muted/10" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="w-full max-w-md bg-card border border-border/50 rounded-xl p-8 shadow-sm">
        <div className="flex flex-col items-center mb-8">
          <img src={logoPath} alt="Midanic Logo" className="h-16 w-auto mb-6" />
          <h1 className="text-3xl font-serif font-bold text-primary text-center">
            {isAr ? 'إنشاء حساب' : 'Create Account'}
          </h1>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{isAr ? 'الاسم الكامل' : 'Full Name'}</FormLabel>
                  <FormControl>
                    <Input placeholder={isAr ? 'محمد أحمد' : 'John Doe'} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{isAr ? 'البريد الإلكتروني' : 'Email'}</FormLabel>
                  <FormControl>
                    <Input placeholder="you@example.com" dir="ltr" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{isAr ? 'كلمة المرور' : 'Password'}</FormLabel>
                  <FormControl>
                    <Input type="password" dir="ltr" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button 
              type="submit" 
              className="w-full h-12 mt-2 text-lg font-medium" 
              disabled={registerMutation.isPending}
            >
              {registerMutation.isPending
                ? (isAr ? 'جاري الإنشاء...' : 'Creating account...')
                : (isAr ? 'تسجيل' : 'Register')}
            </Button>
          </form>
        </Form>

        <div className="mt-8 pt-6 border-t text-center text-sm text-muted-foreground">
          {isAr ? 'لديك حساب بالفعل؟' : 'Already have an account?'}{' '}
          <Link href="/auth/login" className="text-primary hover:text-primary/80 hover:underline font-semibold">
            {isAr ? 'تسجيل الدخول' : 'Login'}
          </Link>
        </div>
      </div>
    </div>
  );
}
