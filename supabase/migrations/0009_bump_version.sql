-- 楽観ロックを実際に機能させる。
--
-- 全テーブルに version 列があり、画面側も .eq("version", 読み込んだ値) を付けて
-- いたが、値を増やす仕組みがどこにも無かったため常に 1 のままで、条件は必ず一致
-- していた。BEFORE UPDATE で version を増やして初めて排他制御が働く。

create or replace function public.bump_version()
returns trigger
language plpgsql
as $$
begin
  new.version = old.version + 1;
  return new;
end;
$$;

create trigger trips_bump_version before update on public.trips for each row execute function public.bump_version();
create trigger profiles_bump_version before update on public.profiles for each row execute function public.bump_version();
create trigger trip_members_bump_version before update on public.trip_members for each row execute function public.bump_version();
create trigger trip_participants_bump_version before update on public.trip_participants for each row execute function public.bump_version();
create trigger itinerary_items_bump_version before update on public.itinerary_items for each row execute function public.bump_version();
create trigger receipts_bump_version before update on public.receipts for each row execute function public.bump_version();
create trigger receipt_items_bump_version before update on public.receipt_items for each row execute function public.bump_version();
create trigger expenses_bump_version before update on public.expenses for each row execute function public.bump_version();
create trigger expense_shares_bump_version before update on public.expense_shares for each row execute function public.bump_version();
create trigger purchases_bump_version before update on public.purchases for each row execute function public.bump_version();
create trigger rentals_bump_version before update on public.rentals for each row execute function public.bump_version();
create trigger packing_items_bump_version before update on public.packing_items for each row execute function public.bump_version();
create trigger shared_notes_bump_version before update on public.shared_notes for each row execute function public.bump_version();
create trigger trip_settings_bump_version before update on public.trip_settings for each row execute function public.bump_version();

-- version を増やす場所をトリガ1つに揃える。関数側で手動加算していると、初期管理者
-- の確定時だけ 2 つ増えてしまう。
create or replace function public.claim_initial_admin(target_trip_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  if exists (
    select 1
    from public.trip_members
    where trip_id = target_trip_id
      and status = 'approved'
  ) then
    return false;
  end if;

  update public.trip_members
  set status = 'approved',
      role = 'admin',
      approved_at = now(),
      removed_at = null
  where trip_id = target_trip_id
    and user_id = auth.uid()
    and status = 'pending';

  return found;
end;
$$;

revoke all on function public.claim_initial_admin(uuid) from public;
grant execute on function public.claim_initial_admin(uuid) to authenticated;
