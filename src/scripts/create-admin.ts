/** @deprecated A LumaPOS owner must belong to an explicitly provisioned store. */
console.error(
  "The single-tenant Supabase admin command has been retired. Use "
  + "ops:provision-store with LUMAPOS_AUTH_PROVIDER=lumapos, then manage staff in LumaPOS.",
);
process.exitCode = 1;
