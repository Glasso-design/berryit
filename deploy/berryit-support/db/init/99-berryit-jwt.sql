-- Sätter JWT-parametrarna som PostgREST och policies läser.
-- Monteras in i imagens egen init-katalog (init-scripts), som en 99-fil så att
-- den körs EFTER imagens egna skript som skapar rollerna.

\set jwt_secret `echo "$JWT_SECRET"`
\set jwt_exp `echo "$JWT_EXP"`

alter database postgres set "app.settings.jwt_secret" to :'jwt_secret';
alter database postgres set "app.settings.jwt_exp" to :'jwt_exp';
