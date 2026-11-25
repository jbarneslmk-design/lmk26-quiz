-- =====================================================================
--  LMK 26 quiz — UPDATE 1 (25 Nov): allow more than one drawing round.
--  Neon console → LMK TESTING → SQL Editor → paste all of this → Run.
--  Safe to run more than once. Doesn't touch your questions, password or PIN.
-- =====================================================================
-- Apply writes. ops = [{"p":"players/abc","v":{...}}, {"p":"answers/3"} (remove), ...]
-- Players may only: join (players/<own id>), answer once while a question is open
-- (answers/<q>/<own id>), and send their drawing during a drawing round (drawings/<round>/<own id>).
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
      elsif array_length(p, 1) = 3 and p[1] = 'drawings' and p[2] ~ '^[0-9]{1,2}$' and p[3] = p_pid and v is not null then
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

revoke all on function quiz.write(text,text,jsonb) from public;
grant execute on function quiz.write(text,text,jsonb) to quiz_web;
select 'updated: drawings are now saved per drawing round' as result;
