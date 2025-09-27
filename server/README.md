# Sendix Server

API de autenticación con Express + Prisma + JWT.

## Endpoints

- POST /api/auth/register { email, password, role? }
- POST /api/auth/login { email, password }
- POST /api/auth/refresh { refreshToken }
- GET  /api/me (Bearer access) → datos del token
- GET  /api/admin-stats (Bearer access, rol ADMIN)

## Desarrollo

1) Copia .env.example a .env y ajusta secretos.
2) Instala deps y genera Prisma

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

## Notas
- Roles válidos: EMPRESA, TRANSPORTISTA, ADMIN
- Contraseñas se guardan con bcrypt.
- Access token expira en 15m y refresh en 7d.
- Base de datos: SQLite (archivo). Cambiar `DATABASE_URL` si se desea.