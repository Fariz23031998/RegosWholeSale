import { createContext, useContext, useEffect, type ReactNode } from "react";

type RegisterSettings = (open: (() => void) | null) => void;

const ProductsTopBarContext = createContext<RegisterSettings | null>(null);

export function ProductsTopBarProvider({
  register,
  children,
}: {
  register: RegisterSettings;
  children: ReactNode;
}) {
  return (
    <ProductsTopBarContext.Provider value={register}>{children}</ProductsTopBarContext.Provider>
  );
}

export function useRegisterProductsSettings(openSettings: (() => void) | null) {
  const register = useContext(ProductsTopBarContext);

  useEffect(() => {
    if (!register) return;
    register(openSettings);
    return () => register(null);
  }, [openSettings, register]);
}
