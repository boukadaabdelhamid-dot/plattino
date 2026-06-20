import React from "react";
import { useLocation } from "wouter";
import { useLang } from "@/hooks/use-lang";
import { useMe } from "@/hooks/use-me";
import { usePermissions, type PermSection } from "@/hooks/use-permissions";
import {
  Package, ShoppingCart, FileText, Wallet,
  UserCheck, Truck, Users, LayoutDashboard,
  Activity, BarChart2, Clock, Calendar, CreditCard,
} from "lucide-react";

type HomeModule = {
  labelFr: string;
  labelAr: string;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  color: string;
  section: PermSection;
};

const modules: HomeModule[] = [
  { labelFr: "Articles",        labelAr: "المنتجات",      href: "/products",        icon: Package,         color: "bg-cyan-500",    section: "products" },
  { labelFr: "Ventes",          labelAr: "المبيعات",      href: "/orders",          icon: ShoppingCart,    color: "bg-emerald-500", section: "orders" },
  { labelFr: "Achats",          labelAr: "المشتريات",     href: "/purchase-orders", icon: FileText,        color: "bg-rose-500",    section: "purchases" },
  { labelFr: "Caisse",          labelAr: "الصندوق",       href: "/caisse",          icon: Wallet,          color: "bg-amber-500",   section: "caisse" },
  { labelFr: "Clients",         labelAr: "العملاء",       href: "/customers",       icon: UserCheck,       color: "bg-sky-500",     section: "customers" },
  { labelFr: "Fournisseurs",    labelAr: "الموردون",      href: "/suppliers",       icon: Truck,           color: "bg-violet-500",  section: "suppliers" },
  { labelFr: "Employés",        labelAr: "الموظفون",      href: "/employees",       icon: Users,           color: "bg-indigo-500",  section: "employees" },
  { labelFr: "Tableau de bord", labelAr: "لوحة التحكم",  href: "/dashboard",       icon: LayoutDashboard, color: "bg-slate-600",   section: "dashboard" },
  { labelFr: "Temps Réel",      labelAr: "الوقت الفعلي", href: "/realtime",        icon: Activity,        color: "bg-pink-500",    section: "realtime" },
  { labelFr: "Stock",           labelAr: "المخزون",       href: "/inventory",       icon: BarChart2,       color: "bg-blue-600",    section: "inventory" },
  { labelFr: "Présences",       labelAr: "الحضور",        href: "/attendance",      icon: Clock,           color: "bg-teal-500",    section: "attendance" },
  { labelFr: "Congés",          labelAr: "الإجازات",      href: "/leaves",          icon: Calendar,        color: "bg-orange-500",  section: "leaves" },
  { labelFr: "Comptabilité",    labelAr: "المحاسبة",      href: "/accounting",      icon: CreditCard,      color: "bg-fuchsia-500", section: "accounting" },
];

export default function Home() {
  const [, navigate] = useLocation();
  const { lang } = useLang();
  const { isAdmin } = useMe();
  const { can } = usePermissions();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;

  const visibleModules = isAdmin
    ? modules
    : modules.filter((m) => can(m.section, "view"));

  return (
    <div className="min-h-screen bg-white">
      <div className="px-6 py-10 sm:py-14 max-w-5xl mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-10">
          {visibleModules.map(({ labelFr, labelAr, href, icon: Icon, color }) => (
            <button
              key={href}
              onClick={() => navigate(href)}
              className="group flex flex-col items-center gap-3 focus:outline-none"
              data-testid={`home-tile-${href.replace("/", "")}`}
            >
              <div
                className={`w-20 h-20 sm:w-24 sm:h-24 rounded-full ${color} flex items-center justify-center group-hover:-translate-y-0.5 transition-transform duration-150`}
              >
                <Icon className="h-9 w-9 sm:h-10 sm:w-10 text-white" strokeWidth={1.75} />
              </div>
              <div className="text-center">
                <p className="font-medium text-gray-800 text-sm">{t(labelFr, labelAr)}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
