# LinkedIn Operating System · Tres Pilares

## Objetivo

Operar prospección de LinkedIn desde el CRM propio sin depender de automatizaciones pagas ni ejecutar acciones no autorizadas dentro de LinkedIn.

LinkedIn sigue siendo el lugar donde la persona envía manualmente invitaciones, mensajes, comentarios y publicaciones. El CRM se encarga del estado, cadencia, tareas, métricas y trazabilidad.

## Pipeline

`Target → Engaged → Connected → Conversation → Need identified → Meeting proposed → Booked → ...`

Interpretación operativa:

- **Target:** prospecto identificado, sin acción todavía.
- **Engaged:** ya hubo interacción o invitación enviada.
- **Connected:** invitación aceptada.
- **Conversation:** hubo respuesta o intercambio sustantivo.
- Etapas posteriores pertenecen al proceso comercial general de Tres Pilares.

## Acciones rápidas

El workspace de LinkedIn permite registrar:

- Invitación enviada
- Invitación aceptada
- Primer DM enviado
- Follow-up #1 enviado
- Follow-up #2 enviado
- Respuesta recibida
- Cierre de outreach

Cada acción actualiza el contacto, registra actividad, completa tareas relacionadas y crea la siguiente tarea cuando aplica.

## Cadencia adoptada

La cadencia combina ideas de los repositorios públicos revisados con el flujo que ya venía usando Tres Pilares:

1. **Invitación:** razón concreta para conectar; sin pitch.
2. **Aceptación:** registrar y esperar aproximadamente un día antes del primer DM.
3. **Primer DM:** breve, continuidad con el hook, aportar algo y un ask pequeño. Sin link de agenda de entrada.
4. **Follow-up #1:** 4 días después del primer DM; debe añadir algo nuevo.
5. **Follow-up #2:** alrededor del día 10 desde el primer DM; cierre de baja presión.
6. **Sin respuesta después del cierre:** pasar a `nurture`.
7. **Respuesta en cualquier momento:** pasar a `conversation` y detener follow-ups abiertos.

## Métricas

El workspace muestra:

- Invitaciones registradas hoy frente a la meta operativa.
- Invitaciones pendientes.
- Pendientes con antigüedad superior al umbral configurado.
- Tasa de aceptación sobre invitaciones registradas.
- Contactos que ya llegaron a conversación o etapas posteriores.

Valores configurables:

```
CRM_LINKEDIN_DAILY_TARGET=5
CRM_LINKEDIN_STALE_DAYS=14
```

La meta diaria es una meta interna del equipo, no un supuesto sobre límites oficiales de LinkedIn.

## Datos nuevos por contacto

- `linkedin_invited_at`
- `linkedin_connected_at`
- `linkedin_first_dm_at`
- `linkedin_followup_1_at`
- `linkedin_followup_2_at`
- `linkedin_last_reply_at`
- `linkedin_last_action_at`

## Fuentes conceptuales revisadas

- Linked-API/linkedin-skills: arquitectura de pipeline, estado pendiente, cadencia y mantenimiento de red.
- Jakeschincariol/linkedin-agent-skill: estructura de invitación, primer DM, dos follow-ups, planificación y énfasis en aprobación humana.

No se copiaron automatizaciones que ejecuten acciones en LinkedIn. La implementación de Tres Pilares conserva ejecución manual dentro de LinkedIn y automatiza la operación del CRM.
