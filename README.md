# Tarjeta Personas Mayores · Municipalidad de Las Cabras

Plataforma web para consultar, ingresar, modificar y eliminar usuarios del beneficio. Los datos viven en una base de datos **Supabase** compartida; cada funcionario entra con correo y contraseña.

## Uso
1. Abre la página e inicia sesión.
2. La primera vez, pulsa **Cargar Excel** y elige «Tarjeta_Personas_Mayores_UNIFICADO.xlsx» (hoja «Unificado»). Los registros se guardan en la base; no hay que volver a cargarlo.
3. Busca, filtra, ordena y usa **Ver / Editar / Eliminar**, o **+ Nuevo usuario**. Los cambios los ven todos.
4. **Descargar Excel** genera un respaldo actualizado.

## Configuración
- `js/config.js`: URL del proyecto y clave **anon/publishable** de Supabase (nunca la `service_role`).
- Tabla `public.usuarios` con seguridad por filas: solo usuarios con sesión iniciada leen o escriben.
- Los usuarios se crean en Supabase > Authentication > Users (registro público desactivado).

## Datos personales
- **No subas el Excel al repositorio** (el `.gitignore` ya lo excluye).
- GitHub Pages es público: la página se ve, pero sin sesión no se accede a ningún dato.
