-- =====================================================================
--  LMK 26 quiz — ONE-PASTE SETUP for the Neon project "LMK TESTING"
--
--  1. Neon console → project LMK TESTING → SQL Editor (database: neondb)
--  2. At the very bottom, replace TYPE-QUIZ-PASSWORD and TYPE-HOST-PIN
--     with your own (password 6+ characters, PIN 4+ digits)
--  3. Paste the whole thing and press Run.
--
--  Touches nothing outside this project. To undo everything after
--  Christmas: delete the LMK TESTING project in Neon.
-- =====================================================================

-- the restricted web login (its password goes in the public page; it can only call quiz functions)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'quiz_web') then
    create role quiz_web login password 'VLtFq6GO0c3b44i0EqmfdyG6l4xv1akr';
  end if;
end $$;

-- =====================================================================
--  LMK 26 quiz — Neon storage
--  Run this in a SEPARATE Neon project (not the SHELL database).
--  It creates schema "quiz", its functions, and the web login
--  "quiz_web", which can do nothing except call the quiz functions.
--  Every call is checked against the quiz password (players) or the
--  host PIN (host), both stored only as bcrypt hashes.
-- =====================================================================
create extension if not exists pgcrypto;
create schema if not exists quiz;

create table if not exists quiz.game (
  game       text primary key,
  pw_hash    text not null,
  host_hash  text not null,
  tree       jsonb not null default '{}'::jsonb,   -- live state everyone syncs
  rev        bigint not null default 0,
  quizdef    jsonb,                               -- questions + answers: host only
  updated_at timestamptz not null default now()
);

create table if not exists quiz.log (
  game text not null references quiz.game(game) on delete cascade,
  rev  bigint not null,
  op   jsonb not null,             -- {"p": "path/to/key", "v": value}  (v absent = removed)
  at   timestamptz not null default now(),
  primary key (game, rev)
);

-- one row per signed-in phone / host screen (token handed out after the password check)
create table if not exists quiz.session (
  token      text primary key,
  game       text not null references quiz.game(game) on delete cascade,
  role       text not null,
  created_at timestamptz not null default now()
);

-- ---------- helpers ----------
create or replace function quiz.now_ms() returns bigint language sql stable as
$$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;

-- replace {".sv":"timestamp"} placeholders with the server time
create or replace function quiz.fix_ts(v jsonb) returns jsonb language plpgsql stable as $$
declare out jsonb;
begin
  if v is null then return null; end if;
  if jsonb_typeof(v) = 'object' then
    if v = '{".sv":"timestamp"}'::jsonb then return to_jsonb(quiz.now_ms()); end if;
    select coalesce(jsonb_object_agg(key, quiz.fix_ts(value)), '{}'::jsonb) into out from jsonb_each(v);
    return out;
  elsif jsonb_typeof(v) = 'array' then
    select coalesce(jsonb_agg(quiz.fix_ts(value) order by ord), '[]'::jsonb) into out
      from jsonb_array_elements(v) with ordinality as t(value, ord);
    return out;
  end if;
  return v;
end $$;

-- set a value at a path, creating objects on the way
create or replace function quiz.set_path(t jsonb, p text[], v jsonb) returns jsonb language plpgsql immutable as $$
declare child jsonb;
begin
  if coalesce(array_length(p, 1), 0) = 0 then return coalesce(v, '{}'::jsonb); end if;
  if t is null or jsonb_typeof(t) <> 'object' then t := '{}'::jsonb; end if;
  if array_length(p, 1) = 1 then return t || jsonb_build_object(p[1], v); end if;
  child := t -> p[1];
  return t || jsonb_build_object(p[1], quiz.set_path(child, p[2:], v));
end $$;

create or replace function quiz.split(p text) returns text[] language sql immutable as
$$ select coalesce(array_remove(string_to_array(p, '/'), ''), '{}') $$;

create or replace function quiz.auth(g quiz.game, p_pw text, p_host text) returns text language plpgsql as $$
begin
  if p_host is not null and p_host <> '' then
    if crypt(p_host, g.host_hash) = g.host_hash then return 'host'; end if;
    perform pg_sleep(0.6);
    raise exception 'bad_pin';
  end if;
  if p_pw is not null and crypt(p_pw, g.pw_hash) = g.pw_hash then return 'player'; end if;
  perform pg_sleep(0.6);
  raise exception 'bad_password';
end $$;

create or replace function quiz.sess(p_token text) returns quiz.session language plpgsql stable as $$
declare s quiz.session;
begin
  select * into s from quiz.session where token = p_token;
  if not found then raise exception 'bad_session'; end if;
  return s;
end $$;

-- ---------- public API (the only things quiz_web may call) ----------

-- Check a password / PIN. Returns {"ok":true,"role":"player"|"host","now":ms}
-- Sign in with the quiz password (players) or host PIN. Returns a session token
-- used for every later call, so the slow password hash is only checked once.
create or replace function quiz.check(p_game text, p_pw text, p_host text) returns jsonb
language plpgsql security definer set search_path = quiz, public, pg_temp as $$
declare g quiz.game; r text; t text;
begin
  select * into g from quiz.game where game = p_game;
  if not found then raise exception 'no_game'; end if;
  r := quiz.auth(g, p_pw, p_host);
  t := encode(gen_random_bytes(24), 'hex');
  insert into quiz.session(token, game, role) values (t, p_game, r);
  return jsonb_build_object('ok', true, 'role', r, 'token', t, 'now', quiz.now_ms());
end $$;

-- Changes since a revision. {"rev":n,"now":ms} when nothing changed,
-- {"ops":[...]} for small gaps, {"full":tree} for a fresh start.
create or replace function quiz.sync(p_token text, p_since bigint) returns jsonb
language plpgsql security definer set search_path = quiz, public, pg_temp as $$
declare s quiz.session; g quiz.game; lo bigint; ops jsonb; p_game text;
begin
  s := quiz.sess(p_token); p_game := s.game;
  select * into g from quiz.game where game = p_game;
  if p_since = g.rev then
    return jsonb_build_object('rev', g.rev, 'now', quiz.now_ms());
  end if;
  select min(rev) into lo from quiz.log where game = p_game;
  if p_since <= 0 or p_since > g.rev or lo is null or p_since < lo - 1 then
    return jsonb_build_object('rev', g.rev, 'now', quiz.now_ms(), 'full', g.tree);
  end if;
  select jsonb_agg(op order by rev) into ops from quiz.log where game = p_game and rev > p_since;
  return jsonb_build_object('rev', g.rev, 'now', quiz.now_ms(), 'ops', coalesce(ops, '[]'::jsonb));
end $$;

-- Apply writes. ops = [{"p":"players/abc","v":{...}}, {"p":"answers/3"} (remove), ...]
-- Players may only: join (players/<own id>), answer once while a question is open
-- (answers/<q>/<own id>), and send their drawing during the drawing round (drawings/<own id>).
-- Everything else needs the host PIN.
create or replace function quiz.write(p_token text, p_pid text, p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = quiz, public, pg_temp as $$
declare s quiz.session; g quiz.game; role text; op jsonb; p text[]; v jsonb; st jsonb; n int := 0; p_game text;
begin
  s := quiz.sess(p_token); p_game := s.game; role := s.role;
  select * into g from quiz.game where game = p_game for update;
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 60 then raise exception 'bad_ops'; end if;
  if length(p_ops::text) > 600000 then raise exception 'too_big'; end if;

  for op in select * from jsonb_array_elements(p_ops) loop
    p := quiz.split(op ->> 'p');
    v := quiz.fix_ts(op -> 'v');
    if v = 'null'::jsonb then v := null; end if;

    if role <> 'host' then
      st := g.tree -> 'state';
      if p_pid is null or length(p_pid) < 6 or length(p_pid) > 40 then raise exception 'forbidden'; end if;
      if array_length(p, 1) = 2 and p[1] = 'players' and p[2] = p_pid and v is not null then
        if jsonb_typeof(v -> 'name') <> 'string' or length(v ->> 'name') > 24 or length(v::text) > 300 then raise exception 'bad_name'; end if;
      elsif array_length(p, 1) = 3 and p[1] = 'answers' and p[3] = p_pid and v is not null then
        if coalesce(st ->> 'phase', '') <> 'question' or coalesce(st ->> 'q', '') <> p[2] then raise exception 'closed'; end if;
        if quiz.now_ms() > (st ->> 'endsAt')::numeric + 2000 then raise exception 'closed'; end if;
        if g.tree #> p is not null then raise exception 'already_answered'; end if;
        if length(v::text) > 200 then raise exception 'too_big'; end if;
      elsif array_length(p, 1) = 2 and p[1] = 'drawings' and p[2] = p_pid and v is not null then
        if coalesce(st ->> 'phase', '') not in ('draw', 'drawdone') then raise exception 'closed'; end if;
        if jsonb_typeof(v -> 'img') <> 'string' or length(v ->> 'img') > 400000 then raise exception 'too_big'; end if;
      else
        raise exception 'forbidden';
      end if;
    end if;

    if coalesce(array_length(p, 1), 0) = 0 then
      g.tree := coalesce(v, '{}'::jsonb);
    elsif v is null then
      g.tree := g.tree #- p;
    else
      g.tree := quiz.set_path(g.tree, p, v);
    end if;
    g.rev := g.rev + 1; n := n + 1;
    insert into quiz.log(game, rev, op) values (p_game, g.rev,
      case when v is null then jsonb_build_object('p', array_to_string(p, '/')) else jsonb_build_object('p', array_to_string(p, '/'), 'v', v) end);
  end loop;

  update quiz.game set tree = g.tree, rev = g.rev, updated_at = now() where game = p_game;
  return jsonb_build_object('rev', g.rev, 'now', quiz.now_ms(), 'applied', n);
end $$;

-- Host-only: wipe the live game (players, answers, scores, drawings) but keep the questions.
create or replace function quiz.reset(p_token text) returns jsonb
language plpgsql security definer set search_path = quiz, public, pg_temp as $$
declare s quiz.session; g quiz.game; r bigint; p_game text;
begin
  s := quiz.sess(p_token); p_game := s.game;
  if s.role <> 'host' then raise exception 'forbidden'; end if;
  select * into g from quiz.game where game = p_game for update;
  r := g.rev + 1;
  delete from quiz.log where game = p_game;
  insert into quiz.log(game, rev, op) values (p_game, r, '{"p":"","v":{"state":{"phase":"lobby"}}}');
  update quiz.game set tree = '{"state":{"phase":"lobby"}}', rev = r, updated_at = now() where game = p_game;
  return jsonb_build_object('rev', r, 'now', quiz.now_ms());
end $$;

-- Host-only: store / fetch the questions (with answers). Players can never read this.
create or replace function quiz.host_put_quiz(p_token text, p_quiz jsonb) returns jsonb
language plpgsql security definer set search_path = quiz, public, pg_temp as $$
declare s quiz.session; p_game text;
begin
  s := quiz.sess(p_token); p_game := s.game;
  if s.role <> 'host' then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_quiz -> 'questions') <> 'array' then raise exception 'bad_quiz'; end if;
  update quiz.game set quizdef = p_quiz, updated_at = now() where game = p_game;
  return jsonb_build_object('ok', true, 'questions', jsonb_array_length(p_quiz -> 'questions'));
end $$;

create or replace function quiz.host_get_quiz(p_token text) returns jsonb
language plpgsql security definer set search_path = quiz, public, pg_temp as $$
declare s quiz.session; g quiz.game;
begin
  s := quiz.sess(p_token);
  if s.role <> 'host' then raise exception 'forbidden'; end if;
  select * into g from quiz.game where game = s.game;
  return g.quizdef;
end $$;

-- Owner-only (NOT granted to quiz_web): create a game or change its password / PIN.
--   select quiz.setup('lmk26', 'the quiz password', 'the host pin');
create or replace function quiz.setup(p_game text, p_pw text, p_host text) returns text
language plpgsql security definer set search_path = quiz, public, pg_temp as $$
begin
  if p_pw ilike 'TYPE-%' or p_host ilike 'TYPE-%' then raise exception 'Replace the TYPE-... placeholders with your own quiz password and host PIN'; end if;
  if length(p_pw) < 6 or length(p_host) < 4 then raise exception 'Quiz password needs 6+ characters, host PIN 4+'; end if;
  insert into quiz.game(game, pw_hash, host_hash, tree)
    values (p_game, crypt(p_pw, gen_salt('bf', 8)), crypt(p_host, gen_salt('bf', 8)), '{"state":{"phase":"lobby"}}')
  on conflict (game) do update set pw_hash = excluded.pw_hash, host_hash = excluded.host_hash, updated_at = now();
  delete from quiz.session where game = p_game;   -- everyone signs in again with the new password
  return 'ok: ' || p_game;
end $$;

-- ---------- the web login ----------
-- Create it once (choose your own long random password), e.g.:
--   create role quiz_web login password 'LONG-RANDOM-STRING';
-- then run the grants below. Its password ends up in the public web page, which is
-- fine: it can only call these functions, and they all demand the quiz password.
revoke all on schema quiz from public;
revoke all on all tables in schema quiz from public;
revoke all on all functions in schema quiz from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'quiz_web') then
    execute 'grant usage on schema quiz to quiz_web';
    execute 'grant execute on function quiz.check(text,text,text), quiz.sync(text,bigint),
             quiz.write(text,text,jsonb), quiz.reset(text),
             quiz.host_put_quiz(text,jsonb), quiz.host_get_quiz(text) to quiz_web';
    execute 'alter role quiz_web set statement_timeout = ''8s''';
    execute 'revoke create on schema public from quiz_web';
  end if;
end $$;


-- ---------- YOUR PASSWORD AND PIN (edit these two, then Run) ----------
select quiz.setup('lmk26', 'TYPE-QUIZ-PASSWORD', 'TYPE-HOST-PIN');
