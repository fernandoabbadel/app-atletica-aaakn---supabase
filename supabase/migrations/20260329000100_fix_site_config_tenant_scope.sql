update public.site_config
   set tenant_id = public.mt_extract_tenant_id_from_scoped_text_id(id::text)
 where tenant_id is null
   and public.mt_extract_tenant_id_from_scoped_text_id(id::text) is not null;
