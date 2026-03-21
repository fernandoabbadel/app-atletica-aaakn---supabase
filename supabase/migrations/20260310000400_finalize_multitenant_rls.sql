-- Final hardening for multi-tenant isolation:
-- 1) explicit RLS for users
-- 2) private/owner policies for user-sensitive tables
-- 3) manage-only writes for safe config tables

alter table public.users enable row level security;

drop policy if exists users_select_scoped on public.users;
drop policy if exists users_insert_self_or_manage on public.users;
drop policy if exists users_update_self_or_manage on public.users;
drop policy if exists users_delete_manage on public.users;

create policy users_select_scoped on public.users
  for select to authenticated
  using (
    public.mt_is_platform_master()
    or uid = auth.uid()::text
    or public.mt_can_access_tenant_row(tenant_id)
  );

create policy users_insert_self_or_manage on public.users
  for insert to authenticated
  with check (
    public.mt_is_platform_master()
    or public.mt_can_manage_tenant(tenant_id)
    or (
      uid = auth.uid()::text
      and (tenant_id is null or tenant_id = public.mt_current_tenant_id())
    )
  );

create policy users_update_self_or_manage on public.users
  for update to authenticated
  using (
    public.mt_is_platform_master()
    or uid = auth.uid()::text
    or public.mt_can_manage_tenant(tenant_id)
  )
  with check (
    public.mt_is_platform_master()
    or public.mt_can_manage_tenant(tenant_id)
    or (
      uid = auth.uid()::text
      and (
        (
          tenant_id is null
          and (
            select u.tenant_id
            from public.users u
            where u.uid = auth.uid()::text
            limit 1
          ) is null
        )
        or tenant_id = (
          select u.tenant_id
          from public.users u
          where u.uid = auth.uid()::text
          limit 1
        )
      )
    )
  );

create policy users_delete_manage on public.users
  for delete to authenticated
  using (
    public.mt_is_platform_master()
    or public.mt_can_manage_tenant(tenant_id)
  );

do $$
declare
  table_name text;
  manage_only_tables text[] := array[
    'achievements_config',
    'album_config',
    'app_config',
    'categorias',
    'guia_data',
    'historic_events',
    'legal_docs',
    'patentes_config',
    'planos',
    'settings',
    'site_config'
  ];
begin
  foreach table_name in array manage_only_tables loop
    execute format('alter table public.%I enable row level security', table_name);

    execute format('drop policy if exists tenant_scope_select on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_update on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_delete on public.%I', table_name);
    execute format('drop policy if exists tenant_manage_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_manage_update on public.%I', table_name);
    execute format('drop policy if exists tenant_manage_delete on public.%I', table_name);

    execute format(
      'create policy tenant_scope_select on public.%I for select to authenticated using (public.mt_can_access_tenant_row(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_manage_insert on public.%I for insert to authenticated with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_manage_update on public.%I for update to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id)) with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_manage_delete on public.%I for delete to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id))',
      table_name
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['activity_logs'] loop
    execute format('alter table public.%I enable row level security', table_name);

    execute format('drop policy if exists tenant_scope_select on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_update on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_delete on public.%I', table_name);
    execute format('drop policy if exists tenant_logs_select_manage on public.%I', table_name);
    execute format('drop policy if exists tenant_logs_insert_scoped on public.%I', table_name);
    execute format('drop policy if exists tenant_logs_update_manage on public.%I', table_name);
    execute format('drop policy if exists tenant_logs_delete_manage on public.%I', table_name);

    execute format(
      'create policy tenant_logs_select_manage on public.%I for select to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_logs_insert_scoped on public.%I for insert to authenticated with check (public.mt_can_access_tenant_row(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_logs_update_manage on public.%I for update to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id)) with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_logs_delete_manage on public.%I for delete to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id))',
      table_name
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['notifications'] loop
    execute format('alter table public.%I enable row level security', table_name);

    execute format('drop policy if exists tenant_scope_select on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_update on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_delete on public.%I', table_name);
    execute format('drop policy if exists tenant_notification_select on public.%I', table_name);
    execute format('drop policy if exists tenant_notification_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_notification_update on public.%I', table_name);
    execute format('drop policy if exists tenant_notification_delete on public.%I', table_name);

    execute format(
      'create policy tenant_notification_select on public.%I for select to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or "userId" = auth.uid()::text)',
      table_name
    );

    execute format(
      'create policy tenant_notification_insert on public.%I for insert to authenticated with check (public.mt_can_access_tenant_row(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_notification_update on public.%I for update to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or "userId" = auth.uid()::text) with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or "userId" = auth.uid()::text)',
      table_name
    );

    execute format(
      'create policy tenant_notification_delete on public.%I for delete to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or "userId" = auth.uid()::text)',
      table_name
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['orders'] loop
    execute format('alter table public.%I enable row level security', table_name);

    execute format('drop policy if exists tenant_scope_select on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_update on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_delete on public.%I', table_name);
    execute format('drop policy if exists tenant_orders_select on public.%I', table_name);
    execute format('drop policy if exists tenant_orders_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_orders_update on public.%I', table_name);
    execute format('drop policy if exists tenant_orders_delete on public.%I', table_name);

    execute format(
      'create policy tenant_orders_select on public.%I for select to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or "userId" = auth.uid()::text)',
      table_name
    );

    execute format(
      'create policy tenant_orders_insert on public.%I for insert to authenticated with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or "userId" = auth.uid()::text)',
      table_name
    );

    execute format(
      'create policy tenant_orders_update on public.%I for update to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id)) with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_orders_delete on public.%I for delete to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or "userId" = auth.uid()::text)',
      table_name
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['reviews'] loop
    execute format('alter table public.%I enable row level security', table_name);

    execute format('drop policy if exists tenant_scope_select on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_update on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_delete on public.%I', table_name);
    execute format('drop policy if exists tenant_reviews_select on public.%I', table_name);
    execute format('drop policy if exists tenant_reviews_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_reviews_update on public.%I', table_name);
    execute format('drop policy if exists tenant_reviews_delete on public.%I', table_name);

    execute format(
      'create policy tenant_reviews_select on public.%I for select to authenticated using (public.mt_can_access_tenant_row(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_reviews_insert on public.%I for insert to authenticated with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or "userId" = auth.uid()::text)',
      table_name
    );

    execute format(
      'create policy tenant_reviews_update on public.%I for update to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id)) with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_reviews_delete on public.%I for delete to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or "userId" = auth.uid()::text)',
      table_name
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
  owner_column text;
begin
  for table_name, owner_column in
    select *
    from (
      values
        ('support_requests', 'userId'),
        ('banned_appeals', 'userId'),
        ('store_redemptions', 'userId'),
        ('solicitacoes_adesao', 'userId'),
        ('solicitacoes_ingressos', 'userId'),
        ('quiz_history', 'userId'),
        ('achievements_logs', 'userId')
    ) as items(table_name, owner_column)
  loop
    execute format('alter table public.%I enable row level security', table_name);

    execute format('drop policy if exists tenant_scope_select on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_update on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_delete on public.%I', table_name);
    execute format('drop policy if exists tenant_owner_select on public.%I', table_name);
    execute format('drop policy if exists tenant_owner_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_owner_update on public.%I', table_name);
    execute format('drop policy if exists tenant_owner_delete on public.%I', table_name);

    execute format(
      'create policy tenant_owner_select on public.%I for select to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or %I = auth.uid()::text)',
      table_name,
      owner_column
    );

    execute format(
      'create policy tenant_owner_insert on public.%I for insert to authenticated with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or %I = auth.uid()::text)',
      table_name,
      owner_column
    );

    execute format(
      'create policy tenant_owner_update on public.%I for update to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id)) with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_owner_delete on public.%I for delete to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or %I = auth.uid()::text)',
      table_name,
      owner_column
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
  owner_column text;
begin
  for table_name, owner_column in
    select *
    from (
      values
        ('community_category_reads', 'userId'),
        ('gym_logs', 'userId')
    ) as items(table_name, owner_column)
  loop
    execute format('alter table public.%I enable row level security', table_name);

    execute format('drop policy if exists tenant_scope_select on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_update on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_delete on public.%I', table_name);
    execute format('drop policy if exists tenant_owner_select on public.%I', table_name);
    execute format('drop policy if exists tenant_owner_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_owner_update on public.%I', table_name);
    execute format('drop policy if exists tenant_owner_delete on public.%I', table_name);

    execute format(
      'create policy tenant_owner_select on public.%I for select to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or %I = auth.uid()::text)',
      table_name,
      owner_column
    );

    execute format(
      'create policy tenant_owner_insert on public.%I for insert to authenticated with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or %I = auth.uid()::text)',
      table_name,
      owner_column
    );

    execute format(
      'create policy tenant_owner_update on public.%I for update to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or %I = auth.uid()::text) with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or %I = auth.uid()::text)',
      table_name,
      owner_column,
      owner_column
    );

    execute format(
      'create policy tenant_owner_delete on public.%I for delete to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or %I = auth.uid()::text)',
      table_name,
      owner_column
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
  owner_column text;
begin
  for table_name, owner_column in
    select *
    from (
      values
        ('users_followers', 'uid'),
        ('users_following', 'userId')
    ) as items(table_name, owner_column)
  loop
    execute format('alter table public.%I enable row level security', table_name);

    execute format('drop policy if exists tenant_scope_select on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_update on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_delete on public.%I', table_name);
    execute format('drop policy if exists tenant_follow_select on public.%I', table_name);
    execute format('drop policy if exists tenant_follow_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_follow_update on public.%I', table_name);
    execute format('drop policy if exists tenant_follow_delete on public.%I', table_name);

    execute format(
      'create policy tenant_follow_select on public.%I for select to authenticated using (public.mt_can_access_tenant_row(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_follow_insert on public.%I for insert to authenticated with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or %I = auth.uid()::text)',
      table_name,
      owner_column
    );

    execute format(
      'create policy tenant_follow_update on public.%I for update to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or %I = auth.uid()::text) with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or %I = auth.uid()::text)',
      table_name,
      owner_column,
      owner_column
    );

    execute format(
      'create policy tenant_follow_delete on public.%I for delete to authenticated using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id) or %I = auth.uid()::text)',
      table_name,
      owner_column
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
