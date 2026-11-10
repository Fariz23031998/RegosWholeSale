import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ProductsPage } from "@/components/Products/ProductsPage";
import { languageService } from "@/services/language";
import { useCatalog } from "@/store/catalog";

export const Route = createFileRoute("/_app/products")({
  head: () => ({
    meta: [
      { title: languageService.t("meta.productsTitle", "Products · Regos Optom") },
      {
        name: "description",
        content: languageService.t(
          "meta.productsDescription",
          "Select products and print labels.",
        ),
      },
    ],
  }),
  component: ProductsRoute,
});

function ProductsRoute() {
  const hydrateCatalogUi = useCatalog((state) => state.hydrateUiPreferences);

  useEffect(() => {
    void hydrateCatalogUi();
  }, [hydrateCatalogUi]);

  return <ProductsPage />;
}
