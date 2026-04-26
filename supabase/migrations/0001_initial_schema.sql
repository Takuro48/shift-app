-- Step 2: shift-app MVP の初期スキーマ
-- 仕様書 shift-app-spec.md セクション 4 に対応

-- 1. staff: スタッフ名簿
create table staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  display_order int not null default 0,
  password_hash text,
  created_at timestamptz not null default now()
);

-- 2. shift_frames: シフト枠マスタ(早番/遅番/通し など)
create table shift_frames (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_time time not null,
  end_time time not null,
  color text not null default 'green',
  display_order int not null default 0
);

-- 3. required_counts: 必要人数(枠 × 曜日カテゴリ)
create table required_counts (
  id uuid primary key default gen_random_uuid(),
  shift_frame_id uuid not null references shift_frames(id) on delete cascade,
  day_category text not null check (day_category in ('weekday', 'friday', 'saturday', 'sunday_holiday')),
  count int not null check (count >= 0),
  unique (shift_frame_id, day_category)
);

-- 4. shift_requests: スタッフの希望シフト
create table shift_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  date date not null,
  shift_frame_id uuid not null references shift_frames(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, date, shift_frame_id)
);

-- 5. shift_assignments: 確定シフト(休みは shift_frame_id = NULL)
create table shift_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  date date not null,
  shift_frame_id uuid references shift_frames(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, date)
);

-- updated_at 自動更新トリガー
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger shift_requests_updated_at
  before update on shift_requests
  for each row execute function set_updated_at();

create trigger shift_assignments_updated_at
  before update on shift_assignments
  for each row execute function set_updated_at();

-- MVP は認証なし運用(URL を身内に共有のみ。仕様書 1.4)。
-- v1.1 で認証導入時に RLS 有効化 + ポリシー追加する。
alter table staff disable row level security;
alter table shift_frames disable row level security;
alter table required_counts disable row level security;
alter table shift_requests disable row level security;
alter table shift_assignments disable row level security;
