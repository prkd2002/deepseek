"use client";

import { useUser } from "@clerk/nextjs";
import { createContext, useContext, ReactNode } from "react";

// Définir le type du contexte
interface AppContextType {
  user: ReturnType<typeof useUser>["user"];
}

// Créer le contexte avec une valeur par défaut (null)
export const AppContext = createContext<AppContextType | undefined>(undefined);

// Hook personnalisé pour utiliser le contexte
export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within an AppContextProvider");
  }
  return context;
};

// Définir les props du provider
interface AppContextProviderProps {
  children: ReactNode;
}

// Le provider du contexte
export const AppContextProvider = ({ children }: AppContextProviderProps) => {
  const { user } = useUser();

  const value = {
    user,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
};
