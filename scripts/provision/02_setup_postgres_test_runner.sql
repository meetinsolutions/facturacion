-- ==============================================================================
-- 02_setup_postgres_test_runner.sql
-- Configuración de aislamiento estricto de base de datos para entorno de pruebas
-- Se ejecuta dentro del contenedor facturacion_postgres como superusuario facturacion_admin
-- ==============================================================================

-- 1. Crear el rol de pruebas si no existe (con permisos estrictamente mínimos)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'facturacion_test_runner') THEN
        EXECUTE format('CREATE ROLE facturacion_test_runner WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS false;', :'test_runner_pass');
    ELSE
        EXECUTE format('ALTER ROLE facturacion_test_runner WITH PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;', :'test_runner_pass');
    END IF;
END $$;

-- 2. AISLAMIENTO ESTRICTO:
-- En PostgreSQL, PUBLIC posee CONNECT por defecto en bases de datos a menos que se revoque.
-- Para garantizar que facturacion_test_runner no herede CONNECT hacia la base de producción:
-- Revocamos CONNECT en facturacion_saas a PUBLIC, y se lo concedemos explícitamente a facturacion_admin.
REVOKE ALL PRIVILEGES ON DATABASE facturacion_saas FROM PUBLIC;
REVOKE CONNECT ON DATABASE facturacion_saas FROM PUBLIC;
REVOKE ALL PRIVILEGES ON DATABASE facturacion_saas FROM facturacion_test_runner;
REVOKE CONNECT ON DATABASE facturacion_saas FROM facturacion_test_runner;
GRANT CONNECT ON DATABASE facturacion_saas TO facturacion_admin;

-- 3. PERMISOS EXCLUSIVOS SOBRE facturacion_test
GRANT CONNECT ON DATABASE facturacion_test TO facturacion_test_runner;

\c facturacion_test

-- 4. Esquema public en facturacion_test
GRANT USAGE ON SCHEMA public TO facturacion_test_runner;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO facturacion_test_runner;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO facturacion_test_runner;

-- 5. Privilegios por defecto para futuras tablas y secuencias en facturacion_test
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO facturacion_test_runner;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO facturacion_test_runner;
