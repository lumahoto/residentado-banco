-- Residentado v0.6.18 - soporte de imágenes por pregunta
-- Ejecutar una sola vez en el SQL Editor de Supabase.

begin;

alter table public.questions
  add column if not exists image_required boolean not null default false,
  add column if not exists image_url text,
  add column if not exists image_alt text,
  add column if not exists image_caption text,
  add column if not exists image_source_page integer,
  add column if not exists image_source_bbox text;

update public.questions
set
  image_required = true,
  image_url = 'assets/questions/RM-2022-A-038.jpg',
  image_alt = 'Tira de electrocardiograma con intervalos R-R irregulares y ausencia de ondas P organizadas.',
  image_caption = 'Electrocardiograma adjunto del examen oficial 2022, Prueba A, pregunta 38.',
  image_source_page = 5,
  image_source_bbox = '154.35,619.51,440.95,712.56'
where id = 'RM-2022-A-038';

commit;

-- Verificación recomendada:
-- select id, image_required, image_url, image_source_page
-- from public.questions
-- where image_required = true;
