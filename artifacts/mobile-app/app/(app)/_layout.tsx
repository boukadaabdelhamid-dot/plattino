import React from "react";
import { Drawer } from "expo-router/drawer";
import { Feather } from "@expo/vector-icons";
import { Pressable } from "react-native";
import { DrawerActions } from "@react-navigation/native";
import { useNavigation } from "expo-router";
import DrawerContent from "@/components/DrawerContent";
import { colors } from "@/lib/colors";

function MenuButton() {
  const navigation = useNavigation();
  return (
    <Pressable
      onPress={() => navigation.dispatch(DrawerActions.toggleDrawer())}
      style={{ paddingHorizontal: 12 }}
      hitSlop={12}
    >
      <Feather name="menu" size={22} color="#fff" />
    </Pressable>
  );
}

export default function AppLayout() {
  return (
    <Drawer
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "700" },
        drawerType: "front",
        headerLeft: () => <MenuButton />,
      }}
    >
      <Drawer.Screen name="home" options={{ title: "Midanic" }} />
      <Drawer.Screen name="dashboard" options={{ title: "Tableau de bord" }} />
      <Drawer.Screen name="mon-compte" options={{ title: "Mon compte" }} />
      <Drawer.Screen name="orders/index" options={{ title: "Commandes" }} />
      <Drawer.Screen name="orders/new" options={{ title: "Nouvelle commande", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="orders/[id]" options={{ title: "Commande" }} />
      <Drawer.Screen name="sale-orders/index" options={{ title: "Bons de vente" }} />
      <Drawer.Screen name="online-orders/index" options={{ title: "Commandes en ligne" }} />
      <Drawer.Screen name="retours/index" options={{ title: "Retours" }} />
      <Drawer.Screen name="retours/new" options={{ title: "Nouveau retour", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="customers/index" options={{ title: "Clients" }} />
      <Drawer.Screen name="customers/[id]" options={{ title: "Client" }} />
      <Drawer.Screen name="caisse/index" options={{ title: "Caisse" }} />
      <Drawer.Screen name="caisse/[id]" options={{ title: "Caisse", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="caisse/transfers" options={{ title: "Transferts caisse", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="caisse/transfer-new" options={{ title: "Nouveau virement", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="caisse/reports" options={{ title: "Rapports caisse" }} />
      <Drawer.Screen name="products/index" options={{ title: "Produits" }} />
      <Drawer.Screen name="products/new" options={{ title: "Nouveau produit", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="products/[id]" options={{ title: "Produit" }} />
      <Drawer.Screen name="products/[id]/edit" options={{ title: "Modifier le produit", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="inventory/index" options={{ title: "Inventaire" }} />
      <Drawer.Screen name="transfers/index" options={{ title: "Transferts" }} />
      <Drawer.Screen name="transfers/new" options={{ title: "Nouveau transfert", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="transfers/[id]" options={{ title: "Transfert" }} />
      <Drawer.Screen name="suppliers/index" options={{ title: "Fournisseurs" }} />
      <Drawer.Screen name="suppliers/new" options={{ title: "Nouveau fournisseur", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="suppliers/[id]" options={{ title: "Fournisseur" }} />
      <Drawer.Screen name="suppliers/[id]/edit" options={{ title: "Modifier le fournisseur", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="purchase-orders/index" options={{ title: "Bons d'achat" }} />
      <Drawer.Screen name="purchase-orders/new" options={{ title: "Nouveau bon d'achat", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="purchase-orders/[id]" options={{ title: "Bon d'achat" }} />
      <Drawer.Screen name="purchase-orders/[id]/edit" options={{ title: "Modifier le bon d'achat", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="smart-purchase/index" options={{ title: "Achat intelligent" }} />
      <Drawer.Screen name="smart-purchase/suggestion-form" options={{ title: "Nouvelle idée", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="employees/index" options={{ title: "Employés" }} />
      <Drawer.Screen name="employees/new" options={{ title: "Nouvel employé", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="employees/[id]/edit" options={{ title: "Modifier l'employé", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="attendance/index" options={{ title: "Présence" }} />
      <Drawer.Screen name="attendance/new" options={{ title: "Pointage", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="leaves/index" options={{ title: "Congés" }} />
      <Drawer.Screen name="leaves/new" options={{ title: "Nouvelle demande de congé", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="accounting/index" options={{ title: "Comptabilité" }} />
      <Drawer.Screen name="accounting/transaction-new" options={{ title: "Nouvelle transaction", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="reports/index" options={{ title: "Rapports" }} />
      <Drawer.Screen name="realtime/index" options={{ title: "Temps réel" }} />
      <Drawer.Screen name="stores/index" options={{ title: "Magasins" }} />
      <Drawer.Screen name="stores/new" options={{ title: "Nouveau magasin", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="stores/[id]/edit" options={{ title: "Modifier le magasin", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="staff/index" options={{ title: "Personnel" }} />
      <Drawer.Screen name="staff/new" options={{ title: "Nouveau membre", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="staff/[id]" options={{ title: "Membre du personnel", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="permissions/index" options={{ title: "Permissions" }} />
      <Drawer.Screen name="permissions/[id]" options={{ title: "Modifier les permissions", drawerItemStyle: { display: "none" } }} />
      <Drawer.Screen name="settings/index" options={{ title: "Paramètres" }} />
      <Drawer.Screen name="settings/products" options={{ title: "Paramètres produits" }} />
      <Drawer.Screen name="settings/profile" options={{ title: "Profil" }} />
      <Drawer.Screen name="settings/notifications" options={{ title: "Notifications" }} />
      <Drawer.Screen name="settings/languages" options={{ title: "Langues" }} />
      <Drawer.Screen name="settings/backup" options={{ title: "Sauvegarde" }} />
      <Drawer.Screen name="settings/customers" options={{ title: "Paramètres clients" }} />
      <Drawer.Screen name="settings/web-store" options={{ title: "Boutique en ligne" }} />
    </Drawer>
  );
}
