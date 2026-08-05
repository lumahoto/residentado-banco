-- Solo lectura.
select
  position('PT409' in pg_get_functiondef('public.save_practice_session_state(uuid,bigint,jsonb,jsonb,integer,bigint,bigint,text,integer)'::regprocedure)) > 0 as usa_pt409,
  position('40001' in pg_get_functiondef('public.save_practice_session_state(uuid,bigint,jsonb,jsonb,integer,bigint,bigint,text,integer)'::regprocedure)) = 0 as elimino_40001;

select id, title, status, state_revision, answered_count, planned_count,
       client_app_version, updated_at, completed_at
from public.practice_sessions
where user_id = (select auth.uid())
order by updated_at desc
limit 20;
