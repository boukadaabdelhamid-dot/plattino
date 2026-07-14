import type { PermSection } from "@/contexts/permissions-context";

export type MenuItem = {
  key: string;
  href: string;
  icon: keyof typeof import("@expo/vector-icons/Feather").default.glyphMap;
  labelFr: string;
  labelAr: string;
  section?: PermSection;
  adminOnly?: boolean;
};

export type MenuGroup = {
  key: string;
  titleFr: string;
  titleAr: string;
  items: MenuItem[];
};

export const MENU_GROUPS: MenuGroup[] = [
  {
    key: "main",
    titleFr: "Général",
    titleAr: "عام",
    items: [
      { key: "home", href: "/home", icon: "home", labelFr: "Accueil", labelAr: "الرئيسية" },
      { key: "dashboard", href: "/dashboard", icon: "bar-chart-2", labelFr: "Tableau de bord", labelAr: "لوحة التحكم", section: "dashboard" },
      { key: "mon-compte", href: "/mon-compte", icon: "user", labelFr: "Mon compte", labelAr: "حسابي" },
    ],
  },
  {
    key: "sales",
    titleFr: "Ventes",
    titleAr: "المبيعات",
    items: [
      { key: "orders", href: "/orders", icon: "shopping-bag", labelFr: "Commandes", labelAr: "الطلبات", section: "orders" },
      { key: "sale-orders", href: "/sale-orders", icon: "file-text", labelFr: "Bons de vente", labelAr: "فواتير البيع", section: "orders" },
      { key: "online-orders", href: "/online-orders", icon: "globe", labelFr: "Commandes en ligne", labelAr: "الطلبات الإلكترونية", section: "orders" },
      { key: "retours", href: "/retours", icon: "corner-up-left", labelFr: "Retours", labelAr: "المرتجعات", section: "orders" },
      { key: "customers", href: "/customers", icon: "users", labelFr: "Clients", labelAr: "العملاء", section: "customers" },
      { key: "caisse", href: "/caisse", icon: "credit-card", labelFr: "Caisse", labelAr: "الصندوق", section: "caisse" },
    ],
  },
  {
    key: "catalog",
    titleFr: "Catalogue & Stock",
    titleAr: "المنتجات والمخزون",
    items: [
      { key: "products", href: "/products", icon: "package", labelFr: "Produits", labelAr: "المنتجات", section: "products" },
      { key: "inventory", href: "/inventory", icon: "archive", labelFr: "Inventaire", labelAr: "الجرد", section: "inventory" },
      { key: "transfers", href: "/transfers", icon: "repeat", labelFr: "Transferts", labelAr: "التحويلات", section: "inventory" },
      { key: "suppliers", href: "/suppliers", icon: "truck", labelFr: "Fournisseurs", labelAr: "الموردون", section: "suppliers" },
      { key: "purchase-orders", href: "/purchase-orders", icon: "clipboard", labelFr: "Bons d'achat", labelAr: "أوامر الشراء", section: "purchases" },
      { key: "smart-purchase", href: "/smart-purchase", icon: "zap", labelFr: "Achat intelligent", labelAr: "الشراء الذكي", section: "purchases" },
    ],
  },
  {
    key: "hr",
    titleFr: "Ressources humaines",
    titleAr: "الموارد البشرية",
    items: [
      { key: "employees", href: "/employees", icon: "user-check", labelFr: "Employés", labelAr: "الموظفون", section: "employees" },
      { key: "attendance", href: "/attendance", icon: "clock", labelFr: "Présence", labelAr: "الحضور", section: "attendance" },
      { key: "leaves", href: "/leaves", icon: "calendar", labelFr: "Congés", labelAr: "الإجازات", section: "leaves" },
    ],
  },
  {
    key: "finance",
    titleFr: "Finance",
    titleAr: "المالية",
    items: [
      { key: "accounting", href: "/accounting", icon: "trending-up", labelFr: "Comptabilité", labelAr: "المحاسبة", section: "accounting" },
      { key: "caisse-reports", href: "/caisse/reports", icon: "pie-chart", labelFr: "Rapports caisse", labelAr: "تقارير الصندوق", adminOnly: true },
      { key: "reports", href: "/reports", icon: "file", labelFr: "Rapports", labelAr: "التقارير", adminOnly: true },
    ],
  },
  {
    key: "admin",
    titleFr: "Administration",
    titleAr: "الإدارة",
    items: [
      { key: "realtime", href: "/realtime", icon: "activity", labelFr: "Temps réel", labelAr: "الوقت الفعلي", section: "realtime" },
      { key: "stores", href: "/stores", icon: "shopping-cart", labelFr: "Magasins", labelAr: "المتاجر", adminOnly: true },
      { key: "staff", href: "/staff", icon: "users", labelFr: "Personnel", labelAr: "الموظفون الإداريون", adminOnly: true },
      { key: "permissions", href: "/permissions", icon: "lock", labelFr: "Permissions", labelAr: "الصلاحيات", adminOnly: true },
      { key: "settings", href: "/settings", icon: "settings", labelFr: "Paramètres", labelAr: "الإعدادات", section: "settings" },
    ],
  },
];
