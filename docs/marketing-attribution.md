# Atribución de marketing · Tres Pilares

## Objetivo

Que cada cita pueda responder, cuando exista información suficiente:

1. ¿Desde qué canal llegó?
2. ¿Desde qué perfil o marca?
3. ¿Desde qué pieza o punto de contacto?
4. ¿Cuál fue su primer touch?
5. ¿Cuál fue su último touch antes de agendar?

El sitio conserva el primer touch en el navegador y actualiza el último touch cuando detecta una nueva fuente significativa. Al agendar, ambos se envían al backend y quedan vinculados a la cita y al contacto del CRM.

## Convención UTM

### `utm_source`
Red o canal.

Valores recomendados:
- `linkedin`
- `instagram`
- `tiktok`
- `facebook`
- `youtube`
- `google`
- `email`
- `whatsapp`

### `utm_medium`
Tipo de tráfico.

Valores recomendados:
- `organic_social`
- `paid_social`
- `dm`
- `email`
- `whatsapp`
- `organic_search`
- `cpc`

### `utm_campaign`
Perfil, marca o iniciativa que originó el tráfico.

Usar siempre slugs estables:
- `tres_pilares`
- `juan_david`
- `giovanna`
- `carolina`
- `finanzas_con_esco`
- `plan_a_tres`

### `utm_content`
Pieza o ubicación concreta.

Ejemplos:
- `profile`
- `bio`
- `reel_proteccion_202609`
- `post_patimonio_202609`
- `story_diagnostico_202609`
- `dm_prospecto`
- `newsletter_202609`

### `utm_term`
Opcional. Reservar principalmente para paid media, keywords o audiencias.

---

## Links base recomendados

### LinkedIn · Juan David
```
https://trespilares.co/?utm_source=linkedin&utm_medium=organic_social&utm_campaign=juan_david&utm_content=profile
```

### LinkedIn · Giovanna
```
https://trespilares.co/?utm_source=linkedin&utm_medium=organic_social&utm_campaign=giovanna&utm_content=profile
```

### LinkedIn · Carolina
```
https://trespilares.co/?utm_source=linkedin&utm_medium=organic_social&utm_campaign=carolina&utm_content=profile
```

### Instagram · Tres Pilares
```
https://trespilares.co/?utm_source=instagram&utm_medium=organic_social&utm_campaign=tres_pilares&utm_content=bio
```

### Instagram · Finanzas con Esco
```
https://trespilares.co/?utm_source=instagram&utm_medium=organic_social&utm_campaign=finanzas_con_esco&utm_content=bio
```

### Instagram · Giovanna
```
https://trespilares.co/?utm_source=instagram&utm_medium=organic_social&utm_campaign=giovanna&utm_content=bio
```

### Instagram · Carolina
```
https://trespilares.co/?utm_source=instagram&utm_medium=organic_social&utm_campaign=carolina&utm_content=bio
```

### Instagram · Juan David
```
https://trespilares.co/?utm_source=instagram&utm_medium=organic_social&utm_campaign=juan_david&utm_content=bio
```

## Links para mensajes directos

Para un CTA enviado por DM:

```
https://trespilares.co/?utm_source=linkedin&utm_medium=dm&utm_campaign=juan_david&utm_content=dm_prospecto
```

La identificación individual de un prospecto conocido debe hacerse con el identificador trazable del CRM cuando ese flujo esté habilitado; no incluir nombres, emails ni teléfonos en UTMs.

## Lectura en CRM

- `source_channel`: origen comercial principal del contacto.
- `source_profile`: perfil/campaña de adquisición.
- `source_detail`: pieza o contenido.
- `first_touch`: primera fuente conocida.
- `last_touch`: última fuente significativa antes de la conversión.

Un contacto ya existente conserva su origen principal. Si vuelve por otro canal y agenda, el nuevo recorrido se guarda como `last_touch` sin destruir el origen original.

## Regla operativa

Todo enlace público en bio, perfil, post, reel, story, newsletter o DM que dirija a Tres Pilares debe llevar UTMs. Nunca usar datos personales dentro de parámetros UTM.
