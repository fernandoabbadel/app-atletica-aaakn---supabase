-- Force PostgREST schema cache refresh after tenant migrations.
notify pgrst, 'reload schema';
