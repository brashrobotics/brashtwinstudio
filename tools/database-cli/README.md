# Database CLI

Manages PostgreSQL migrations.

```bash
npm run db:status
npm run db:migrate
```

The tool uses `TWIN_DATABASE_URL` and PostgreSQL pool/SSL environment settings.
It never prints connection URLs or credentials.
