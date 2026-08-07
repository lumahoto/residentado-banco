-- MIGRACIÓN ÚNICA v0.5 DESDE TU ESTADO ACTUAL (v0.3)
-- Incluye todo lo pendiente de v0.4 + v0.5.

-- Migración v0.4: estándar de banqueo + sesiones persistentes


alter table public.questions add column if not exists exam_logic text;

alter table public.questions add column if not exists comparison_title text;

alter table public.questions add column if not exists comparison_framework text;

alter table public.questions add column if not exists common_trap text;

alter table public.questions add column if not exists abbreviations text;

alter table public.questions add column if not exists memory_hook text;

alter table public.questions add column if not exists rentability_status text;

alter table public.questions add column if not exists editorial_standard text;


create table if not exists public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('study','exam')),
  title text not null default 'Sesión',
  config jsonb not null default '{}'::jsonb,
  question_ids text[] not null,
  state jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','completed','abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists practice_sessions_user_status_idx
  on public.practice_sessions (user_id, status, updated_at desc);

alter table public.practice_sessions enable row level security;

drop policy if exists "practice_sessions_select_own" on public.practice_sessions;
create policy "practice_sessions_select_own"
on public.practice_sessions for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "practice_sessions_insert_own" on public.practice_sessions;
create policy "practice_sessions_insert_own"
on public.practice_sessions for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "practice_sessions_update_own" on public.practice_sessions;
create policy "practice_sessions_update_own"
on public.practice_sessions for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "practice_sessions_delete_own" on public.practice_sessions;
create policy "practice_sessions_delete_own"
on public.practice_sessions for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.practice_sessions from anon, authenticated;
grant select, insert, update, delete on table public.practice_sessions to authenticated;


update public.questions set
  exam_logic = 'La clave histórica del PDF es radiografía, pero para el examen actual debes reconocer que la sinusitis bacteriana aguda no complicada se diagnostica clínicamente; 7 días aislados no bastan para el criterio clásico de persistencia.',
  comparison_title = 'Sinusitis bacteriana aguda pediátrica: criterios clínicos',
  comparison_framework = 'PERSISTENTE: síntomas nasales/tos ≥10 días sin mejoría.
INICIO GRAVE: fiebre alta + secreción purulenta por varios días.
DOBLE EMPEORAMIENTO: mejora inicial y luego empeora.
NO COMPLICADA: sin imagen rutinaria.
SOSPECHA DE COMPLICACIÓN orbitaria/intracraneal: considerar TC.',
  common_trap = 'Pedir radiografía o TC solo porque hay secreción purulenta. El color de la secreción no confirma por sí solo etiología bacteriana.',
  abbreviations = 'TC = tomografía computarizada.',
  memory_hook = '10 días / grave / doble empeoramiento.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2024-A-001';

update public.questions set
  exam_logic = 'VEF1/CVF posbroncodilatador <0,70 = obstrucción persistente. En fumador con clínica crónica, la respuesta es patrón obstructivo.',
  comparison_title = 'Patrones espirométricos',
  comparison_framework = 'OBSTRUCTIVO: VEF1/CVF ↓.
RESTRICTIVO: VEF1/CVF normal o ↑; confirmar restricción con capacidad pulmonar total ↓.
MIXTO: VEF1/CVF ↓ + capacidad pulmonar total ↓.
NORMAL: relación y volúmenes dentro de rango.',
  common_trap = 'Llamar «mixto» solo porque el paciente está muy sintomático. El patrón se define por la fisiología, no por la gravedad clínica.',
  abbreviations = 'VEF1 = volumen espiratorio forzado en el primer segundo. CVF = capacidad vital forzada.',
  memory_hook = 'Relación baja = obstrucción.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2024-A-002';

update public.questions set
  exam_logic = 'Para la clasificación clásica usada en bancos: pH 7,10 + bicarbonato 14 mEq/L cae en CAD moderada. La glucosa de 380 mg/dL no define la severidad.',
  comparison_title = 'Cetoacidosis diabética: clasificación clásica de severidad útil para examen',
  comparison_framework = 'LEVE: pH 7,25-7,30; HCO₃⁻ 15-18 mEq/L; sensorio alerta.
MODERADA: pH 7,00-7,24; HCO₃⁻ 10 a <15 mEq/L; alerta o somnolencia.
SEVERA: pH <7,00; HCO₃⁻ <10 mEq/L; estupor o coma.
CASO: pH 7,10 + HCO₃⁻ 14 → MODERADA.',
  common_trap = 'Usar la glucosa para graduar la CAD. La severidad se apoya en la acidosis y el estado clínico.',
  abbreviations = 'CAD = cetoacidosis diabética. HCO₃⁻ = bicarbonato.',
  memory_hook = '15-18 leve / 10-<15 moderada / <10 severa.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2024-A-003';

update public.questions set
  exam_logic = 'A las 38 semanas, un peso fetal estimado en percentil 1 equivale a restricción grave del crecimiento fetal (<p3): corresponde culminar la gestación, no esperar.',
  comparison_title = 'Restricción del crecimiento fetal: dato pivote y momento de culminación',
  comparison_framework = 'PFE <p10: restricción del crecimiento fetal.
PFE <p3: restricción grave.
PFE entre p3-p10 + Doppler umbilical normal: en general culminar hacia 38-39 semanas.
PFE <p3: culminación alrededor de 37 semanas según contexto.
CASO: 38 semanas + p1 + PBF 6/10 → terminar gestación.',
  common_trap = 'Confundir «terminar la gestación» con «cesárea obligatoria». La vía del parto depende del escenario obstétrico; la pregunta pregunta el momento, no necesariamente la vía.',
  abbreviations = 'PFE = peso fetal estimado. p = percentil. PBF = perfil biofísico. Doppler umbilical = evaluación del flujo de la arteria umbilical.',
  memory_hook = '<p3 = grave; a término, no diferir.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2024-A-004';

update public.questions set
  exam_logic = 'Para bajar incidencia de dengue hay que reducir transmisión: control vectorial, ambiente, agua, residuos y acción intersectorial. Aumentar UCI o insumos trata consecuencias, no evita casos nuevos.',
  comparison_title = 'Qué indicador modifica cada estrategia',
  comparison_framework = 'INCIDENCIA ↓: prevención, control vectorial y determinantes.
LETALIDAD ↓: diagnóstico oportuno y manejo adecuado.
CAPACIDAD DE RESPUESTA ↑: camas, UCI, personal e insumos.',
  common_trap = 'Elegir la intervención hospitalaria más «intensa» cuando la pregunta pide reducir incidencia poblacional.',
  abbreviations = 'RISS = Red Integrada de Servicios de Salud. UCI = unidad de cuidados intensivos.',
  memory_hook = 'Incidencia = evitar casos; letalidad = evitar muertes.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2024-A-005';

update public.questions set
  exam_logic = 'Trabajo repetido de rodillas + dolor/tumefacción anterior = bursitis prepatelar; la estructura afectada es la bursa.',
  comparison_title = 'Dolor de rodilla por mecanismo',
  comparison_framework = 'BURSITIS PREPATELAR: presión repetida al arrodillarse, tumefacción anterior.
MENISCO: torsión, dolor en interlínea, bloqueo/chasquido.
LCA: giro/desaceleración, sensación de «pop», inestabilidad.
RÓTULA: trauma directo, luxación o fractura según mecanismo.',
  common_trap = 'Asociar toda dificultad para caminar con lesión meniscal o ligamentaria sin usar el mecanismo.',
  abbreviations = 'LCA = ligamento cruzado anterior.',
  memory_hook = 'Arrodillarse = prepatelar.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2024-B-001';

update public.questions set
  exam_logic = 'Más de 4 semanas después de pancreatitis, una colección madura y líquida sin necrosis corresponde a seudoquiste. Si contiene necrosis, sería necrosis encapsulada.',
  comparison_title = 'Colecciones pancreáticas: tiempo + contenido',
  comparison_framework = '<4 SEMANAS + LÍQUIDO: colección líquida aguda.
>4 SEMANAS + LÍQUIDO + pared: seudoquiste.
<4 SEMANAS + NECROSIS: colección necrótica aguda.
>4 SEMANAS + NECROSIS + pared: necrosis encapsulada (walled-off necrosis).
CASO: 6 semanas → colección madura; la alternativa ofrecida más probable es seudoquiste.',
  common_trap = 'Usar solo el tiempo. La clasificación completa exige también saber si hay detritos necróticos.',
  abbreviations = 'WON = walled-off necrosis, necrosis encapsulada.',
  memory_hook = '4 semanas separa aguda de encapsulada; líquido vs necrosis define el nombre.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2024-B-002';

update public.questions set
  exam_logic = 'Prurito + distribución típica + contacto familiar = escabiosis. En un lactante de 10 meses, permetrina al 5% es primera línea.',
  comparison_title = 'Escabiosis: tratamiento y distractores',
  comparison_framework = 'PERMETRINA 5%: primera línea; puede usarse desde los 2 meses.
LINDANO: no primera línea; riesgo de neurotoxicidad.
CORTICOIDE/TACROLIMUS: reducen inflamación, pero no erradican el ácaro.
Además: tratar contactos estrechos y ropa/ropa de cama.',
  common_trap = 'Tratar solo al paciente o usar un antiinflamatorio porque mejora el prurito.',
  abbreviations = 'No usar abreviaturas necesarias en esta pregunta.',
  memory_hook = 'Escabiosis = paciente + contactos.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2024-B-003';

update public.questions set
  exam_logic = 'RCP pediátrica sin vía aérea avanzada: un reanimador usa 30:2; dos reanimadores usan 15:2 en pacientes prepúberes.',
  comparison_title = 'Relación compresión-ventilación pediátrica',
  comparison_framework = '1 REANIMADOR: 30 compresiones : 2 ventilaciones.
2 REANIMADORES, PREPÚBER: 15:2.
CON VÍA AÉREA AVANZADA: compresiones continuas + ventilación según protocolo.',
  common_trap = 'Responder 15:2 automáticamente por tratarse de pediatría sin leer cuántos reanimadores hay.',
  abbreviations = 'RCP = reanimación cardiopulmonar.',
  memory_hook = 'Solo = 30:2; dúo pediátrico = 15:2.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2024-B-004';

update public.questions set
  exam_logic = 'Día 5 + lactancia exclusiva + pérdida de 8,6% del peso = ingesta subóptima con aumento de circulación enterohepática de bilirrubina.',
  comparison_title = 'Ictericia neonatal: patrón temporal útil',
  comparison_framework = '<24 HORAS: siempre patológica hasta demostrar lo contrario; pensar hemólisis/sepsis.
DÍAS 3-5 + mala ingesta/pérdida ponderal: ictericia por ingesta subóptima.
MÁS TARDÍA, lactante sano que gana peso: ictericia por leche materna.
CEFALOHEMATOMA: antecedente/masa en cuero cabelludo + mayor carga de bilirrubina.',
  common_trap = 'Confundir «ictericia por ingesta subóptima» con «ictericia por leche materna», que suele ser más tardía y con buena ganancia ponderal.',
  abbreviations = 'No usar abreviaturas necesarias en esta pregunta.',
  memory_hook = 'Día 3-5 + baja ingesta = ingesta subóptima.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2024-B-005';

update public.questions set
  exam_logic = 'Es una emergencia hipertensiva porque hay daño agudo de órgano blanco neurológico. La clave oficial es nitroprusiato, pero la pregunta es ambigua: labetalol también es una opción IV defendible.',
  comparison_title = 'Crisis hipertensiva: primero define si hay daño de órgano blanco',
  comparison_framework = 'URGENCIA: PA muy elevada SIN daño agudo de órgano blanco → reducción gradual, habitualmente oral.
EMERGENCIA: PA elevada + daño agudo de órgano blanco → fármaco IV titulable y monitorización.
ENCEFALOPATÍA: nicardipino/clevidipino/labetalol suelen ser opciones preferidas según protocolo; nitroprusiato es utilizable, pero no una respuesta única universal.
EDEMA AGUDO DE PULMÓN/ISQUEMIA: nitroglicerina cobra especial utilidad.',
  common_trap = 'Elegir por el número de presión arterial sin identificar primero el órgano blanco afectado.',
  abbreviations = 'PA = presión arterial. IV = intravenoso.',
  memory_hook = 'Emergencia = presión + órgano blanco.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2025-A-001';

update public.questions set
  exam_logic = 'Secreción blanca solo provocada, sin masa ni síntomas: observación es aceptable. La unilateralidad obliga a vigilar rasgos de secreción patológica.',
  comparison_title = 'Secreción por pezón: fisiológica vs patológica',
  comparison_framework = 'FISIOLÓGICA: provocada, suele ser bilateral/multiductal, color lechoso/verdoso; no requiere imagen rutinaria.
PATOLÓGICA: espontánea, unilateral, uniductal, sanguinolenta o serosa → estudio por imagen según edad.
GALACTORREA verdadera/persistente: considerar prolactina y causas endocrinas/farmacológicas.',
  common_trap = 'Pedir prolactina a toda secreción blanca sin distinguir si es espontánea o solo provocada.',
  abbreviations = 'No usar abreviaturas necesarias en esta pregunta.',
  memory_hook = 'Espontánea + unilateral/uniductal + sangre/serosa = patológica.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2025-A-002';

update public.questions set
  exam_logic = 'La implantación normal ocurre en el endometrio del cuerpo uterino alto, cerca del fondo; entre las alternativas, fondo uterino es la mejor respuesta.',
  comparison_title = 'Sitios de implantación',
  comparison_framework = 'NORMAL: cuerpo uterino alto, con frecuencia pared posterior cerca del fondo.
SEGMENTO INFERIOR: placentación baja/placenta previa.
CERVICAL: embarazo ectópico cervical.
INTERSTICIAL/CORNUAL: implantación anormal en región del cuerno.',
  common_trap = 'Confundir el sitio normal de implantación con la futura localización exacta de la placenta.',
  abbreviations = 'No usar abreviaturas necesarias en esta pregunta.',
  memory_hook = 'Normal = arriba, en el cuerpo/fondo.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2025-A-003';

update public.questions set
  exam_logic = 'El tórax inestable no obliga por sí solo a intubar; aquí se intuba por fracaso fisiológico: cianosis, taquipnea intensa, dificultad respiratoria y shock.',
  comparison_title = 'Tórax inestable: cuándo intubar',
  comparison_framework = 'ESTABLE, oxigena y ventila: analgesia + soporte respiratorio + vigilancia.
INSUFICIENCIA RESPIRATORIA, hipoxemia, fatiga o inestabilidad: intubación y ventilación invasiva.
FIJACIÓN COSTAL: opción seleccionada después de estabilización; no reemplaza ABC inicial.
CASO: FR 36 + cianosis + PA 80/40 → control definitivo de vía aérea.',
  common_trap = 'Memorizar «tórax inestable = intubación» sin mirar la fisiología. La indicación es el compromiso respiratorio/hemodinámico.',
  abbreviations = 'ABC = vía aérea, respiración y circulación. FR = frecuencia respiratoria. PA = presión arterial.',
  memory_hook = 'Intuba al paciente que falla, no a la radiografía.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2025-A-004';

update public.questions set
  exam_logic = 'Ptosis + midriasis + déficit de aducción = lesión del III par craneal (oculomotor).',
  comparison_title = 'III, IV y VI pares craneales: movimiento ocular',
  comparison_framework = 'III (OCULOMOTOR): ptosis, ojo «abajo y afuera»; puede haber midriasis.
IV (TROCLEAR): oblicuo superior; diplopía vertical, peor al bajar escaleras/mirar abajo y adentro.
VI (ABDUCENS): recto lateral; incapacidad para abducir.
CASO: ptosis + pupila dilatada + aducción alterada → III.',
  common_trap = 'Elegir VI solo porque hay diplopía. Usa el movimiento específico y la pupila.',
  abbreviations = 'III = nervio oculomotor. IV = nervio troclear. VI = nervio abducens.',
  memory_hook = 'III: párpado + pupila + casi todos los movimientos.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2025-A-005';

update public.questions set
  exam_logic = 'Trauma penetrante + hemoptisis + enfisema subcutáneo = sospecha de lesión del árbol traqueobronquial.',
  comparison_title = 'Trauma torácico: pista clínica dominante',
  comparison_framework = 'TRAQUEOBRONQUIAL: fuga aérea importante, enfisema subcutáneo, hemoptisis, neumotórax persistente.
VASCULAR MAYOR: shock/hemorragia masiva predominante.
DIAFRAGMA: trayecto toracoabdominal, herniación visceral.
ARTERIA TORÁCICA INTERNA: hemotórax/hemorragia, no fuga aérea primaria.',
  common_trap = 'Elegir la lesión «más letal» en vez de la que explica mejor el patrón de fuga aérea + hemoptisis.',
  abbreviations = 'No usar abreviaturas necesarias en esta pregunta.',
  memory_hook = 'Aire bajo la piel + sangre por vía aérea = árbol traqueobronquial.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2025-B-001';

update public.questions set
  exam_logic = 'Hipotonía + epicanto + puente nasal plano + orejas pequeñas + pliegue palmar único = síndrome de Down.',
  comparison_title = 'Síndromes craneofaciales de los distractores',
  comparison_framework = 'DOWN: hipotonía, epicanto, puente nasal plano, pliegue palmar único.
CROUZON: craneosinostosis + proptosis; sin sindactilia típica.
APERT: craneosinostosis + sindactilia marcada.
TREACHER COLLINS: hipoplasia malar/mandibular y alteraciones auriculares.',
  common_trap = 'Quedarse solo con «rasgos faciales». La hipotonía y el pliegue palmar orientan fuertemente a trisomía 21.',
  abbreviations = 'No usar abreviaturas necesarias en esta pregunta.',
  memory_hook = 'Down = hipotonía + pliegue palmar + epicanto.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2025-B-002';

update public.questions set
  exam_logic = 'Dolor abdominal + efluente turbio + >100 leucocitos/µL y >50% neutrófilos = peritonitis asociada a diálisis peritoneal. El empírico debe cubrir grampositivos y gramnegativos.',
  comparison_title = 'Peritonitis en diálisis peritoneal: diagnóstico y cobertura',
  comparison_framework = 'DIAGNÓSTICO: al menos 2 de 3: clínica compatible; efluente con >100 leucocitos/µL y >50% PMN; cultivo positivo.
EMPÍRICO: cubrir grampositivos + gramnegativos.
VANCOMICINA + AMINOGLUCÓSIDO: combinación aceptable según epidemiología local.
VÍA: intraperitoneal suele preferirse cuando es factible y no hay sepsis sistémica.',
  common_trap = 'Elegir un antibiótico aislado que cubra solo uno de los dos grandes grupos al iniciar tratamiento empírico.',
  abbreviations = 'PMN = polimorfonucleares/neutrófilos. DP = diálisis peritoneal.',
  memory_hook = 'Turbio + >100 + >50% PMN.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2025-B-003';

update public.questions set
  exam_logic = 'Fumador joven con isquemia distal = tromboangeítis obliterante (Buerger). Histología aguda: trombo inflamatorio con microabscesos neutrofílicos y relativa preservación de la pared.',
  comparison_title = 'Buerger vs aterosclerosis',
  comparison_framework = 'BUERGER: joven fumador, vasos pequeños/medianos distales, trombosis inflamatoria segmentaria con microabscesos.
ATEROSCLEROSIS: placas de íntima, factores de riesgo metabólicos/edad, distribución típica de grandes y medianas arterias.
TRATAMIENTO CLAVE EN BUERGER: abandono total del tabaco.',
  common_trap = 'Elegir la descripción de aterosclerosis por la palabra «trombo». En Buerger el trombo es inflamatorio y aparecen microabscesos.',
  abbreviations = 'No usar abreviaturas necesarias en esta pregunta.',
  memory_hook = 'Buerger = tabaco + distal + trombo inflamatorio.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2025-B-004';

update public.questions set
  exam_logic = 'En POP-Q, el borde más distal entre -1 y +1 cm respecto del himen es estadio II. Ba = +1 cm está exactamente en el límite superior del estadio II.',
  comparison_title = 'POP-Q: estadios por relación con el himen',
  comparison_framework = 'ESTADIO I: punto más distal >1 cm por encima del himen.
ESTADIO II: entre -1 y +1 cm del himen.
ESTADIO III: >+1 cm, sin eversión vaginal completa.
ESTADIO IV: eversión prácticamente completa.
CASO: Ba +1 cm → II.',
  common_trap = 'Pensar que cualquier valor positivo ya es estadio III. +1 cm todavía pertenece al estadio II.',
  abbreviations = 'POP-Q = Pelvic Organ Prolapse Quantification, sistema de cuantificación del prolapso de órganos pélvicos. Ba = punto de referencia de la pared vaginal anterior.',
  memory_hook = 'II vive entre -1 y +1.',
  rentability_status = 'PENDIENTE_CALCULO_CORPUS',
  editorial_standard = 'BANQUEO_RESIDENTADO_V1',
  explanation_status = 'ESTANDAR_BANQUEO_V1',
  record_version = '0.4'
where id = 'RM-2025-B-005';


-- ============================================================
-- v0.5 · perfil 75+/80, repaso adaptativo y presión automática
-- Esta migración se ejecuta DESPUÉS del bloque v0.4 incluido arriba.
-- ============================================================

alter table public.questions add column if not exists concept_id text;
alter table public.questions add column if not exists rentability_score numeric;
alter table public.questions add column if not exists rentability_tier text;
alter table public.questions add column if not exists frequency_count integer;
alter table public.questions add column if not exists recent_frequency_count integer;
alter table public.questions add column if not exists concept_repeat_count integer;

update public.questions
set concept_id = coalesce(concept_id, nullif(topic, '')),
    rentability_score = coalesce(rentability_score, 0.55),
    rentability_tier = coalesce(rentability_tier, 'PENDIENTE')
where active = true;

alter table public.attempts add column if not exists memory_rating smallint;
alter table public.attempts add column if not exists speed_bucket text;
alter table public.attempts add column if not exists normalized_speed numeric;
alter table public.attempts add column if not exists target_seconds integer;
alter table public.attempts add column if not exists was_due boolean;

update public.attempts
set target_seconds = coalesce(target_seconds, 25),
    normalized_speed = coalesce(normalized_speed, response_time_ms / 25000.0),
    speed_bucket = coalesce(speed_bucket,
      case
        when timed_out then 'timed_out'
        when not is_correct and response_time_ms <= 25000 then 'wrong_fast'
        when not is_correct then 'incorrect'
        when response_time_ms <= 25000 then 'fluent'
        when response_time_ms <= 40000 then 'slow_correct'
        else 'very_slow_correct'
      end),
    memory_rating = coalesce(memory_rating,
      case
        when timed_out or not is_correct then 1
        when response_time_ms <= 25000 then 4
        when response_time_ms <= 40000 then 3
        else 2
      end)
where memory_rating is null
   or speed_bucket is null
   or normalized_speed is null
   or target_seconds is null;

create table if not exists public.user_learning_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  score_goal integer not null default 75,
  max_exam_score integer not null default 80,
  target_response_seconds integer not null default 25,
  exam_date date not null default date '2026-09-06',
  readiness_target_date date not null default date '2026-08-23',
  plan_start_date date not null default date '2026-07-14',
  pressure_mode text not null default 'demanding',
  auto_plan boolean not null default true,
  travel_periods jsonb not null default '[{"start":"2026-07-25","end":"2026-07-29","mode":"intensive_review","label":"Viaje 1 · repaso intensivo"},{"start":"2026-08-08","end":"2026-08-15","mode":"maintenance","label":"Viaje 2 · mantenimiento"}]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.question_memory_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  difficulty numeric not null default 5,
  stability_days numeric not null default 0,
  estimated_recall numeric not null default 0,
  due_at timestamptz not null default now(),
  consecutive_correct integer not null default 0,
  lapses integer not null default 0,
  last_result boolean,
  last_response_time_ms integer,
  speed_state text,
  last_attempt_at timestamptz,
  last_interval_days numeric,
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create index if not exists question_memory_due_idx
  on public.question_memory_state (user_id, due_at);

alter table public.user_learning_profile enable row level security;
alter table public.question_memory_state enable row level security;

drop policy if exists "learning_profile_select_own" on public.user_learning_profile;
create policy "learning_profile_select_own"
on public.user_learning_profile for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "learning_profile_insert_own" on public.user_learning_profile;
create policy "learning_profile_insert_own"
on public.user_learning_profile for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "learning_profile_update_own" on public.user_learning_profile;
create policy "learning_profile_update_own"
on public.user_learning_profile for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "memory_state_select_own" on public.question_memory_state;
create policy "memory_state_select_own"
on public.question_memory_state for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "memory_state_insert_own" on public.question_memory_state;
create policy "memory_state_insert_own"
on public.question_memory_state for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "memory_state_update_own" on public.question_memory_state;
create policy "memory_state_update_own"
on public.question_memory_state for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "memory_state_delete_own" on public.question_memory_state;
create policy "memory_state_delete_own"
on public.question_memory_state for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.user_learning_profile from anon, authenticated;
grant select, insert, update on table public.user_learning_profile to authenticated;

revoke all on table public.question_memory_state from anon, authenticated;
grant select, insert, update, delete on table public.question_memory_state to authenticated;
