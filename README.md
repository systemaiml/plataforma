# Tarjeta Personas Mayores · Municipalidad de Las Cabras

Plataforma web para consultar, ingresar, modificar y eliminar los registros del beneficio. Sigue la estructura del Excel **Tarjeta_Personas_Mayores_Oficial** (4 hojas). Los datos viven en una base de datos **Supabase** compartida; cada funcionario entra con correo y contraseña.

## Secciones
- **Buscar persona**: busca por nombre o RUT en las 4 hojas a la vez y muestra la ficha completa (en qué hojas está, sus datos y su tarjeta). Desde la ficha se puede agregar a la persona a una hoja donde aún no está.
- **Inscritos**, **Beneficiarios Finales**, **Tarjetas Impresas** y **Tarjetas reimpresas**: una pestaña por hoja, con resumen, búsqueda, filtro, orden por columna y botones Ver / Editar / Eliminar / + Nuevo.

## Uso
1. Abre la página e inicia sesión.
2. Un administrador pulsa **Cargar Excel** y elige el archivo con las hojas «Inscritos», «Beneficiarios Finales», «Tarjetas Impresas» y «Tarjeta re impresas». Cada hoja del archivo reemplaza a la de la base de datos; antes se descarga un respaldo automático.
3. Después se trabaja en la página; los cambios los ven todos.
4. **Descargar Excel** genera el archivo con las mismas 4 hojas (más un resumen), que se puede volver a cargar.

## Configuración
- `js/config.js`: URL del proyecto y clave **anon/publishable** de Supabase (nunca la `service_role`).
- `js/hojas.js`: columnas de cada hoja y cómo se leen del Excel.
- Tablas `public.inscritos`, `public.beneficiarios`, `public.tarjetas`, `public.reimpresiones` con seguridad por filas: solo usuarios con sesión leen o escriben; solo administradores eliminan o cargan el Excel (función `reemplazar_hojas`).
- Administrador = usuario con `app_metadata.role = "admin"` en Supabase > Authentication > Users (registro público desactivado).
- La tabla anterior `public.usuarios` (Excel «Unificado») se conserva como respaldo y ya no la usa la página.

## Datos personales
- **No subas el Excel al repositorio** (el `.gitignore` ya lo excluye).
- GitHub Pages es público: la página se ve, pero sin sesión no se accede a ningún dato.
