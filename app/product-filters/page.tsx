"use client";

// Standalone route for the Product Filters workspace. The same view is the
// "Product Filters" mode in the main app topbar (see app/page.tsx).
import { ProductFiltersView } from "@/components/product-filters-view";

export default function ProductFiltersPage() {
  return <ProductFiltersView />;
}
