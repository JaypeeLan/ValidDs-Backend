/** Strip removed supplier sales/revenue fields on read and ingest. */

const LEGACY_SUPPLIER_SALES_KEYS = [
  'productUnitsSold',
  'estimatedMonthlyRevenue',
  'soldLast30Days',
  'revenueSource',
] as const;

export function stripLegacySupplierSalesFields(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...row };
  for (const key of LEGACY_SUPPLIER_SALES_KEYS) {
    delete out[key];
  }
  return out;
}

export function finalizeApifySuppliers(suppliers: unknown): unknown[] {
  if (!Array.isArray(suppliers)) return [];
  return suppliers.map((s) =>
    s && typeof s === 'object' ? stripLegacySupplierSalesFields(s as Record<string, unknown>) : s,
  );
}
