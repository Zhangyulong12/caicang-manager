-- Keep original email text; reject normalized duplicates without rewriting user data.
-- Expression indexes are maintained in SQL because Prisma schema cannot express lower(btrim()).
CREATE UNIQUE INDEX "uq_users_email_normalized" ON "users" (lower(btrim("email")));
