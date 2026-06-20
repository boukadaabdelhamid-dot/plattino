import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, MutationCache, QueryCache } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth, forceLogout } from "@/hooks/use-auth";
import { StoreProvider, useStoreContext } from "@/hooks/use-store";
import { LangProvider } from "@/hooks/use-lang";
import { useMe } from "@/hooks/use-me";
import { PermissionsProvider, usePermissions, type PermSection } from "@/hooks/use-permissions";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useRealtimeWS } from "@/hooks/use-realtime-ws";
import { Layout } from "@/components/layout/Layout";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import SelectStore from "@/pages/SelectStore";
import Stores from "@/pages/Stores";
import Home from "@/pages/Home";
import Dashboard from "@/pages/Dashboard";
import Orders from "@/pages/Orders";
import OnlineOrders from "@/pages/OnlineOrders";
import Products from "@/pages/Products";
import Employees from "@/pages/Employees";
import Attendance from "@/pages/Attendance";
import Leaves from "@/pages/Leaves";
import Suppliers from "@/pages/Suppliers";
import PurchaseOrders from "@/pages/PurchaseOrders";
import Inventory from "@/pages/Inventory";
import Transfers from "@/pages/Transfers";
import Accounting from "@/pages/Accounting";
import Customers from "@/pages/Customers";
import Caisse from "@/pages/Caisse";
import CaisseReports from "@/pages/CaisseReports";
import MonCompte from "@/pages/MonCompte";
import Reports from "@/pages/Reports";
import RealTime from "@/pages/RealTime";
import Staff from "@/pages/Staff";
import Permissions from "@/pages/Permissions";
import Settings from "@/pages/Settings";
import ProductSettings from "@/pages/ProductSettings";
import SettingsProfile from "@/pages/SettingsProfile";
import SettingsNotifications from "@/pages/SettingsNotifications";
import SettingsLanguages from "@/pages/SettingsLanguages";
import SettingsBackup from "@/pages/SettingsBackup";
import SettingsCustomers from "@/pages/SettingsCustomers";
import WebStoreSettings from "@/pages/WebStoreSettings";

function is401(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: number }).status === 401
  );
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => { if (is401(error)) forceLogout(); },
  }),
  mutationCache: new MutationCache({
    onError: (error) => { if (is401(error)) forceLogout(); },
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => !is401(error) && failureCount < 1,
      staleTime: 30_000,
    },
  },
});

function ProtectedRoute({
  component: Component,
  adminOnly = false,
  section,
}: {
  component: React.ComponentType;
  adminOnly?: boolean;
  section?: PermSection;
}) {
  const { token, logout } = useAuth();
  const { currentStoreId } = useStoreContext();
  const { isAdmin, isStaff, role, isLoading, user } = useMe();
  const { can, isLoaded: permsLoaded } = usePermissions();
  useEffect(() => {
    if (role === "customer") logout();
  }, [role, logout]);
  if (!token) return <Redirect to="/login" />;
  if (isLoading) return <Layout><div className="p-6 text-sm text-muted-foreground">…</div></Layout>;
  if (!isLoading && user && !isStaff) return <Redirect to="/login" />;
  const stores = (user as { stores?: unknown[] } | null)?.stores ?? [];
  if (!currentStoreId && stores.length > 0) return <Redirect to="/select-store" />;
  if (adminOnly && !isAdmin) return <Redirect to="/home" />;
  if (section && !isAdmin) {
    if (!permsLoaded) return <Layout><div className="p-6 text-sm text-muted-foreground">…</div></Layout>;
    if (!can(section, "view")) return <Redirect to="/home" />;
  }
  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function ProtectedHome() {
  const { token, logout } = useAuth();
  const { currentStoreId } = useStoreContext();
  const { user, isStaff, role, isLoading } = useMe();
  useEffect(() => {
    if (role === "customer") logout();
  }, [role, logout]);
  if (!token) return <Redirect to="/login" />;
  if (isLoading) return <Layout><div className="p-6 text-sm text-muted-foreground">…</div></Layout>;
  if (!isLoading && user && !isStaff) return <Redirect to="/login" />;
  const stores = (user as { stores?: unknown[] } | null)?.stores ?? [];
  if (!currentStoreId && stores.length > 0) return <Redirect to="/select-store" />;
  return <Layout><Home /></Layout>;
}

function Router() {
  const { token } = useAuth();
  // Single WS connection scoped to the whole app — keeps transfer list,
  // order list, and inventory cache fresh in real time across pages.
  useRealtimeWS();

  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/select-store" component={SelectStore} />
      <Route path="/">
        {token ? <Redirect to="/home" /> : <Redirect to="/login" />}
      </Route>
      <Route path="/stores">
        <ProtectedRoute component={Stores} adminOnly />
      </Route>
      <Route path="/home">
        <ProtectedHome />
      </Route>
      <Route path="/mon-compte">
        <ProtectedRoute component={MonCompte} />
      </Route>
      <Route path="/dashboard">
        <ProtectedRoute component={Dashboard} section="dashboard" />
      </Route>
      <Route path="/orders">
        <ProtectedRoute component={Orders} section="orders" />
      </Route>
      <Route path="/online-orders">
        <ProtectedRoute component={OnlineOrders} section="orders" />
      </Route>
      <Route path="/products">
        <ProtectedRoute component={Products} section="products" />
      </Route>
      <Route path="/employees">
        <ProtectedRoute component={Employees} section="employees" />
      </Route>
      <Route path="/attendance">
        <ProtectedRoute component={Attendance} section="attendance" />
      </Route>
      <Route path="/leaves">
        <ProtectedRoute component={Leaves} section="leaves" />
      </Route>
      <Route path="/suppliers">
        <ProtectedRoute component={Suppliers} section="suppliers" />
      </Route>
      <Route path="/purchase-orders">
        <ProtectedRoute component={PurchaseOrders} section="purchases" />
      </Route>
      <Route path="/inventory">
        <ProtectedRoute component={Inventory} section="inventory" />
      </Route>
      <Route path="/transfers">
        <ProtectedRoute component={Transfers} section="inventory" />
      </Route>
      <Route path="/accounting">
        <ProtectedRoute component={Accounting} section="accounting" />
      </Route>
      <Route path="/customers">
        <ProtectedRoute component={Customers} section="customers" />
      </Route>
      <Route path="/staff">
        <ProtectedRoute component={Staff} adminOnly />
      </Route>
      <Route path="/permissions">
        <ProtectedRoute component={Permissions} adminOnly />
      </Route>
      <Route path="/reports">
        <ProtectedRoute component={Reports} adminOnly />
      </Route>
      <Route path="/caisse/reports">
        <ProtectedRoute component={CaisseReports} adminOnly />
      </Route>
      <Route path="/caisse">
        <ProtectedRoute component={Caisse} section="caisse" />
      </Route>
      <Route path="/realtime">
        <ProtectedRoute component={RealTime} section="realtime" />
      </Route>
      <Route path="/settings">
        <ProtectedRoute component={Settings} section="settings" />
      </Route>
      <Route path="/settings/products">
        <ProtectedRoute component={ProductSettings} section="settings" />
      </Route>
      <Route path="/settings/profile">
        <ProtectedRoute component={SettingsProfile} section="settings" />
      </Route>
      <Route path="/settings/notifications">
        <ProtectedRoute component={SettingsNotifications} section="settings" />
      </Route>
      <Route path="/settings/languages">
        <ProtectedRoute component={SettingsLanguages} section="settings" />
      </Route>
      <Route path="/settings/backup">
        <ProtectedRoute component={SettingsBackup} section="settings" />
      </Route>
      <Route path="/settings/staff">
        <ProtectedRoute component={Staff} section="settings" />
      </Route>
      <Route path="/settings/customers">
        <ProtectedRoute component={SettingsCustomers} section="settings" />
      </Route>
      <Route path="/settings/web-store">
        <ProtectedRoute component={WebStoreSettings} adminOnly section="settings" />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <LangProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StoreProvider>
              <PermissionsProvider>
                <TooltipProvider>
                  <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                    <Router />
                  </WouterRouter>
                  <Toaster />
                </TooltipProvider>
              </PermissionsProvider>
            </StoreProvider>
          </AuthProvider>
        </QueryClientProvider>
      </LangProvider>
    </ErrorBoundary>
  );
}

export default App;
